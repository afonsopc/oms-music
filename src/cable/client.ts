/**
 * Hand-rolled ActionCable v1 client (DESIGN.md 10.1, FR-105), ported from the
 * web CableService.ts with the native additions the design mandates: a
 * liveness watchdog over ping frames and the centralized foreground wake
 * path. ALL timers live here so foreground/background behavior has a single
 * owner; the socket is left alone in background (iOS freezes the JS clock,
 * notifyForeground heals on wake).
 *
 * Framing:
 * - server -> client: {"type":"welcome"|"ping"|"confirm_subscription"|
 *   "reject_subscription"|"disconnect"} or {"identifier":"...","message":...};
 * - client -> server: {"command":"subscribe"|"unsubscribe","identifier":"..."}
 *   and {"command":"message","identifier":"...","data":"<JSON {action,...}>"}.
 *
 * The identifier is a JSON-ENCODED STRING built once per subscription and
 * compared verbatim against what the server echoes - key order matters.
 */
import { API_BASE_URL } from "@/api/client";
import type {
  CableClient,
  CableState,
  CableSubscription,
  CableSubscriptionHandlers,
} from "./types";

/** Reconnect backoff: 1 s doubling to 30 s, reset on welcome. */
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
/**
 * ActionCable servers ping every ~3 s. A welcomed socket silent for this
 * long is half-dead (NAT drop, radio sleep): cycle it proactively.
 */
const WATCHDOG_STALE_MS = 25_000;
const WATCHDOG_CHECK_MS = 5_000;

interface SubscriptionEntry {
  handlers: CableSubscriptionHandlers;
  wakeHook: (() => void) | null;
}

const buildCableUrl = (token: string): string => {
  const ws = API_BASE_URL.replace(/^http/, "ws");
  // "" is the cookie-auth credential (auth/token.ts#cableCredential): the
  // same-site handshake carries the httpOnly session cookie by itself, so no
  // ?token= is sent at all - the server tries param, header, then cookie.
  if (!token) return `${ws}/cable`;
  return `${ws}/cable?token=${encodeURIComponent(token)}`;
};

class CableClientImpl implements CableClient {
  private socket: WebSocket | null = null;
  /**
   * The connect() credential: a Bearer token, or "" for cookie auth. The
   * distinction that matters everywhere below is null vs non-null ("do we
   * have a credential"), so the guards say `== null`, never truthiness -
   * "" is a live credential.
   */
  private token: string | null = null;
  /** Keyed by the VERBATIM identifier string. */
  private readonly subs = new Map<string, SubscriptionEntry>();
  private welcomed = false;
  private state: CableState = "disconnected";
  private readonly stateListeners = new Set<(s: CableState) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = BACKOFF_INITIAL_MS;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastFrameAt = 0;
  /** Distinguishes an intentional disconnect() from a drop. */
  private intentional = false;

  connect(token: string): void {
    if (this.token === token && (this.socket || this.reconnectTimer)) return;
    this.token = token;
    this.intentional = false;
    this.teardownSocket();
    this.clearReconnect();
    this.reconnectDelay = BACKOFF_INITIAL_MS;
    this.openSocket();
  }

  disconnect(): void {
    this.intentional = true;
    this.token = null;
    this.clearReconnect();
    this.teardownSocket();
    this.setState("disconnected");
  }

  subscribe(
    channelParams: Record<string, unknown>,
    handlers: CableSubscriptionHandlers,
  ): CableSubscription {
    // Built ONCE; the server echoes this exact string back on every frame.
    const identifier = JSON.stringify(channelParams);
    const entry: SubscriptionEntry = { handlers, wakeHook: null };
    this.subs.set(identifier, entry);
    if (this.welcomed) this.send({ command: "subscribe", identifier });

    return {
      perform: (action, data) => {
        // Pre-welcome sends are dropped server-side; drop them here too so
        // callers never need ready guards.
        if (!this.welcomed) return;
        if (this.subs.get(identifier) !== entry) return;
        this.send({
          command: "message",
          identifier,
          data: JSON.stringify({ action, ...(data ?? {}) }),
        });
      },
      unsubscribe: () => {
        if (this.subs.get(identifier) !== entry) return;
        if (this.welcomed) this.send({ command: "unsubscribe", identifier });
        this.subs.delete(identifier);
      },
      setWakeHook: (fn) => {
        entry.wakeHook = fn;
      },
    };
  }

  onStateChange(cb: (s: CableState) => void): () => void {
    this.stateListeners.add(cb);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  notifyForeground(): void {
    if (this.intentional || this.token == null) return;
    if (!this.socket) {
      // Dropped while backgrounded: reconnect NOW, not after the backoff.
      this.clearReconnect();
      this.reconnectDelay = BACKOFF_INITIAL_MS;
      this.openSocket();
      return;
    }
    if (this.welcomed && Date.now() - this.lastFrameAt > WATCHDOG_STALE_MS) {
      // Frozen socket that never closed: cycle it (onclose reconnects).
      this.cycleSocket();
      return;
    }
    if (this.welcomed) {
      for (const entry of this.subs.values()) {
        try {
          entry.wakeHook?.();
        } catch {
          // A wake hook must never break the others.
        }
      }
    }
  }

  // ----- internals ----------------------------------------------------------

  private setState(next: CableState): void {
    if (this.state === next) return;
    this.state = next;
    for (const cb of this.stateListeners) {
      try {
        cb(next);
      } catch {
        // Listener failures never break the socket.
      }
    }
  }

  private openSocket(): void {
    if (this.token == null) return;
    this.setState("connecting");
    let socket: WebSocket;
    try {
      // Token in the QUERY ONLY: no Authorization header on the handshake
      // (the first credential candidate wins; a stale header beats the param).
      socket = new WebSocket(buildCableUrl(this.token));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.lastFrameAt = Date.now();

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.lastFrameAt = Date.now();
      this.startWatchdog();
    };

    socket.onmessage = (event: { data: unknown }) => {
      if (this.socket !== socket) return;
      this.lastFrameAt = Date.now();
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      this.handleFrame(msg);
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.welcomed = false;
      this.stopWatchdog();
      this.setState("disconnected");
      if (!this.intentional) this.scheduleReconnect();
    };

    socket.onerror = () => {
      if (this.socket !== socket) return;
      try {
        socket.close();
      } catch {
        // close() on a dying socket may throw; onclose still fires.
      }
    };
  }

  private handleFrame(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "welcome":
        this.welcomed = true;
        this.reconnectDelay = BACKOFF_INITIAL_MS; // reset on welcome
        this.setState("connected");
        // Resubscribe the ENTIRE map on every welcome.
        for (const identifier of this.subs.keys()) {
          this.send({ command: "subscribe", identifier });
        }
        return;
      case "ping":
        return; // lastFrameAt already refreshed the watchdog
      case "disconnect": {
        // The server asked us to go away; honor reconnect:false.
        const allowReconnect = msg.reconnect !== false;
        if (!allowReconnect) this.intentional = true;
        this.cycleSocket();
        return;
      }
      case "confirm_subscription": {
        const entry = this.subs.get(String(msg.identifier));
        entry?.handlers.onConfirm?.();
        return;
      }
      case "reject_subscription": {
        const entry = this.subs.get(String(msg.identifier));
        entry?.handlers.onReject?.();
        return;
      }
      default: {
        if (typeof msg.identifier === "string" && msg.message !== undefined) {
          this.subs.get(msg.identifier)?.handlers.onMessage(msg.message);
        }
      }
    }
  }

  private send(payload: Record<string, unknown>): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      // A send on a closing socket is a no-op; onclose handles recovery.
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentional || this.token == null) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, BACKOFF_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      if (!this.socket || !this.welcomed) return;
      if (Date.now() - this.lastFrameAt > WATCHDOG_STALE_MS) this.cycleSocket();
    }, WATCHDOG_CHECK_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private cycleSocket(): void {
    const socket = this.socket;
    if (!socket) return;
    try {
      socket.close();
    } catch {
      // onclose still runs the recovery path.
    }
  }

  private teardownSocket(): void {
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    this.welcomed = false;
    this.stopWatchdog();
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close();
    } catch {
      // Already dying.
    }
  }
}

let singleton: CableClientImpl | null = null;

/** The one cable for the app lifetime. Connect when authed, disconnect on logout. */
export const getCableClient = (): CableClient => {
  if (!singleton) singleton = new CableClientImpl();
  return singleton;
};
