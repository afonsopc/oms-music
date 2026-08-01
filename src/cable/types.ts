/**
 * CableClient frozen interface (DESIGN.md 10.1). Hand-rolled minimal
 * ActionCable v1 client; @kesha-antonov/react-native-action-cable stays an
 * escape hatch behind this exact interface but is NOT used.
 *
 * Rules (API.md section 13, all mandatory):
 * - token in the QUERY ONLY; never an Authorization header on the handshake
 *   (the first credential candidate wins and a stale header beats the param);
 * - wait for `welcome` before any subscribe (pre-welcome sends are dropped
 *   server-side);
 * - the identifier is a JSON-encoded string with stable key order, stored
 *   and compared VERBATIM (the server echoes the exact string);
 * - reconnect backoff 1 s doubling to 30 s, reset on welcome;
 * - resubscribe the entire subscription map on every welcome;
 * - ping frames refresh a liveness watchdog; a silent socket is proactively
 *   cycled;
 * - anonymous connects SUCCEED: `reject_subscription` is the auth failure.
 */

export type CableState = "disconnected" | "connecting" | "connected";

export interface CableSubscriptionHandlers {
  onMessage(msg: unknown): void;
  onConfirm?(): void;
  /** Per-channel auth failure signal (anonymous connects succeed). */
  onReject?(): void;
}

export interface CableSubscription {
  perform(action: string, data?: Record<string, unknown>): void;
  unsubscribe(): void;
  /** e.g. request_snapshot + heartbeat on foreground. */
  setWakeHook(fn: () => void): void;
}

export interface CableClient {
  /** wss://backend.omelhorsite.pt/cable?token=<token> */
  connect(token: string): void;
  disconnect(): void;
  subscribe(
    channelParams: Record<string, unknown>,
    handlers: CableSubscriptionHandlers,
  ): CableSubscription;
  onStateChange(cb: (s: CableState) => void): () => void;
  /** Fires per-subscription wake hooks; reconnects if dropped. */
  notifyForeground(): void;
}
