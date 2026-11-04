/**
 * DevicePicker surfaces (FR-111 UI half): the cast button that lives in the
 * MiniPlayer pill and Now Playing, the quiet "A tocar em X" line, and the
 * bottom sheet listing devices.
 *
 * Sheet contents, in the web's order:
 *  - "Play here" = transfer to OUR device id (disabled while already active);
 *  - every ONLINE other device as a transfer target, with a check on the
 *    active one and a "needs a tap" hint when it reported activation_blocked;
 *    rows without a recent heartbeat dim to "seen X min ago" and eventually
 *    hide (remote/presence.ts - device ids are per-launch, so relaunches
 *    leave roster ghosts that otherwise look online forever);
 *  - offline recents as disabled rows (display-only: transfer requires an
 *    online registry row).
 *
 * The picker is hidden entirely while `role === "offline"` (logged out, or
 * no snapshot ever received): there is nothing to cast to.
 */
import React, { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { showAirplayPickerWeb } from "@/cast/airplayWeb";
import { discoverDlna, startDlnaSession } from "@/cast/drivers/dlna";
import { startNativeCastDiscovery, startNativeCastSession } from "@/cast/drivers/nativeCast";
import { requestWebCastSession } from "@/cast/drivers/webCast";
import { castCapabilities } from "@/cast/register";
import { endCast } from "@/cast/session";
import { castDeviceLabel, castStore, isCasting, useCastStore } from "@/cast/store";
import type { CastTarget } from "@/cast/types";
import { getRoutePickerView } from "../../../modules/oms-native";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { GhostIconButton, Icon, BottomSheet, type IconName } from "@/ui";
import { remoteRequestSnapshot, remoteTransferTo } from "@/remote/channel";
import {
  devicePresence,
  presenceAnchorMs,
  PRESENCE_TICK_MS,
  ROSTER_REFRESH_MS,
} from "@/remote/presence";
import {
  deviceDisplayLabel,
  remoteStore,
  selectActiveDevice,
  useRemoteStore,
} from "@/remote/store";
import type { OverlaySlot } from "@/features/shell/slots";

/**
 * The shared icon set (WP4) carries no phone/laptop/tablet glyphs, so every
 * row uses the cast glyph rather than a misleading stand-in; the device type
 * still reads in the label the server composes.
 */
const DEVICE_ICON: IconName = "cast";

/** O selector AirPlay do iOS (AVRoutePickerView), resolvido uma vez. */
const RoutePicker = Platform.OS === "ios" ? getRoutePickerView() : null;

const useFallbackLabel = (): string => useT()("components.music.DevicePicker.deviceFallback");

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

const DeviceRow = ({
  label,
  onPress,
  disabled,
  checked,
  online,
  dimmed,
  hint,
  hintMuted,
  first,
  overlay,
  busy,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  checked?: boolean;
  online?: boolean;
  /** Stale presence: esbatida mas ainda tocável (o servidor confirma). */
  dimmed?: boolean;
  hint?: string | null;
  /** "seen X min ago" reads muted; the emerald tone stays for live hints. */
  hintMuted?: boolean;
  first?: boolean;
  /** Vista nativa por cima da linha (o selector AirPlay do iOS). */
  overlay?: React.ReactNode;
  /** A ligar: o ponto fica a piscar devagar em vez do visto. */
  busy?: boolean;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!checked }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: tokens.border,
        opacity: (disabled ? 0.45 : dimmed ? 0.5 : 1) * (pressed ? 0.7 : 1),
      })}
    >
      <Icon name={DEVICE_ICON} size={20} color={tokens.mutedForeground} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}>
          {label}
        </Text>
        {hint ? (
          <Text style={{ color: hintMuted ? tokens.mutedForeground : tokens.foreground, fontSize: 12 }}>
            {hint}
          </Text>
        ) : null}
      </View>
      {checked ? (
        <Icon name="check" size={18} color={tokens.primary} />
      ) : busy ? (
        <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>…</Text>
      ) : online ? (
        <View
          style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tokens.foreground }}
        />
      ) : null}
      {overlay}
    </Pressable>
  );
};

/**
 * The picker's content, host-agnostic: the mobile shell serves it in a
 * BottomSheet, the desktop right panel renders it as the Devices tenant.
 * `onTransfer` fires after a transfer is requested - the sheet closes on it,
 * the panel just stays put.
 */
export const DevicePickerBody = ({ onTransfer }: { onTransfer?: () => void }) => {
  const t = useT();
  const { tokens } = useTheme();
  const fallback = useFallbackLabel();
  const ready = useRemoteStore((s) => s.ready);
  const role = useRemoteStore((s) => s.role);
  const devices = useRemoteStore((s) => s.devices);
  const yourDeviceId = useRemoteStore((s) => s.yourDeviceId);
  const activeDeviceId = useRemoteStore((s) => s.activeDeviceId);
  const blockedDeviceId = useRemoteStore((s) => s.blockedDeviceId);
  const activeDevice = useRemoteStore(selectActiveDevice);
  const devicesAt = useRemoteStore((s) => s.devicesAt);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Roster hygiene while the picker is actually on screen (sheet open, or
  // the desktop Devices tenant selected): a fresh snapshot on mount makes
  // the server reap dead rows, and the tick re-derives the presence ages
  // below - re-requesting once the roster itself is too old to tell a dead
  // row from a merely stale frame.
  useEffect(() => {
    remoteRequestSnapshot();
    const timer = setInterval(() => {
      setNowMs(Date.now());
      if (Date.now() - remoteStore.getState().devicesAt > ROSTER_REFRESH_MS) {
        remoteRequestSnapshot();
      }
    }, PRESENCE_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Self is matched by id (the wire carries no is_self) and folded into
  // "Play here" instead of being listed twice. Rows long without a heartbeat
  // (per-launch ids leave ghosts behind every relaunch) dim or drop; they
  // stay tappable while dimmed because the roster may just be old, and a
  // truly dead row now answers with the transfer_failed toast anyway.
  const anchorMs = presenceAnchorMs(devices);
  const rosterAgeMs = devicesAt > 0 ? nowMs - devicesAt : 0;
  const onlineOthers = devices
    .filter((d) => d.online && d.id !== yourDeviceId)
    .map((device) => ({ device, presence: devicePresence(device, anchorMs, rosterAgeMs) }))
    .filter(({ presence }) => presence.kind !== "gone");
  const recents = devices.filter((d) => !d.online);

  const castPhase = useCastStore((s) => s.phase);
  const castName = useCastStore((s) => s.deviceName);
  const castKind = useCastStore((s) => s.kind);
  const airplayRoute = useCastStore((s) => s.airplayRoute);
  const casting = castPhase !== "idle";

  const transfer = (deviceId: string): void => {
    // Escolher um aparelho da app tira o som da TV.
    if (isCasting()) endCast({ resumeHere: false, stopTv: true });
    remoteTransferTo(deviceId);
    onTransfer?.();
  };

  const playHere = (): void => {
    if (isCasting()) {
      endCast({ resumeHere: true, stopTv: true });
      onTransfer?.();
      return;
    }
    if (yourDeviceId) transfer(yourDeviceId);
  };

  const castLabel = casting ? castDeviceLabel(castName, castKind) : null;
  const airplayLabel = airplayRoute ? castDeviceLabel(airplayRoute, "airplay") : null;
  const playingOn = castLabel ?? airplayLabel ?? (activeDevice ? deviceDisplayLabel(activeDevice, fallback) : null);

  return (
    <>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 4 }}>
        <Text style={{ color: tokens.foreground, fontSize: 18, fontWeight: "800" }}>
          {t("components.music.DevicePicker.cast")}
        </Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
          {playingOn
            ? `${t("components.music.DevicePicker.playingOnLabel")} ${playingOn}`
            : t("components.music.DevicePicker.noActiveDevice")}
        </Text>
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: tokens.border }}>
        {yourDeviceId || casting ? (
          <DeviceRow
            first
            label={t("components.music.DevicePicker.playHere")}
            disabled={!casting && (!ready || role === "active")}
            checked={!casting && role === "active"}
            onPress={playHere}
          />
        ) : null}
        {onlineOthers.map(({ device, presence }) => (
          <DeviceRow
            key={device.id}
            label={deviceDisplayLabel(device, fallback)}
            disabled={!ready}
            checked={device.id === activeDeviceId}
            online={presence.kind === "fresh"}
            dimmed={presence.kind === "stale"}
            hint={
              presence.kind === "stale"
                ? t("components.music.DevicePicker.lastSeen", { minutes: presence.minutes })
                : device.id === blockedDeviceId
                  ? t("components.music.DevicePicker.needsInteraction")
                  : null
            }
            hintMuted={presence.kind === "stale"}
            onPress={() => transfer(device.id)}
          />
        ))}
        {recents.length > 0 ? (
          <View style={{ borderTopWidth: 1, borderTopColor: tokens.border, paddingTop: 8 }}>
            <Text
              style={{
                color: tokens.mutedForeground,
                fontSize: 11,
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 1,
                paddingHorizontal: 16,
                paddingBottom: 4,
              }}
            >
              {t("components.music.DevicePicker.offlineRecent")}
            </Text>
            {recents.map((device, index) => (
              <DeviceRow
                key={device.id}
                first={index === 0}
                label={deviceDisplayLabel(device, fallback)}
                disabled
              />
            ))}
          </View>
        ) : null}
      </View>
      <CastTargets onPicked={onTransfer} />
    </>
  );
};

const SectionTitle = ({ text }: { text: string }) => {
  const { tokens } = useTheme();
  return (
    <Text
      style={{
        color: tokens.mutedForeground,
        fontSize: 11,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 1,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 4,
      }}
    >
      {text}
    </Text>
  );
};

/**
 * TVs e colunas: Chromecast (a lista do SDK no telemóvel; a do Chrome na
 * web), AirPlay (a lista do sistema) e TVs DLNA (no computador). Procura
 * enquanto a lista está aberta.
 */
const CastTargets = ({ onPicked }: { onPicked?: () => void }) => {
  const t = useT();
  const { tokens } = useTheme();
  const caps = castCapabilities();
  const targets = useCastStore((s) => s.targets);
  const phase = useCastStore((s) => s.phase);
  const castName = useCastStore((s) => s.deviceName);
  const castKind = useCastStore((s) => s.kind);
  const error = useCastStore((s) => s.error);
  const airplayRoute = useCastStore((s) => s.airplayRoute);
  const airplayAvailable = useCastStore((s) => s.airplayAvailable);
  // No computador procura TVs DLNA logo que a lista abre.
  const [searching, setSearching] = useState(caps.dlna);

  const search = (): void => {
    if (!caps.dlna) return;
    setSearching(true);
    void discoverDlna().finally(() => setSearching(false));
  };

  useEffect(() => {
    castStore.setState({ error: null });
    const stop = caps.chromecastNativeList ? startNativeCastDiscovery() : () => undefined;
    if (caps.dlna) void discoverDlna().finally(() => setSearching(false));
    return stop;
  }, [caps.chromecastNativeList, caps.dlna]);

  if (!caps.chromecast && !caps.airplay && !caps.dlna) return null;

  const isCurrent = (target: CastTarget): boolean =>
    phase !== "idle" && castKind === target.kind && castName === target.name;

  const pick = (target: CastTarget): void => {
    if (isCurrent(target)) return;
    if (phase !== "idle") endCast({ resumeHere: false, stopTv: true });
    if (target.kind === "dlna") startDlnaSession(target);
    else void startNativeCastSession(target);
    onPicked?.();
  };

  const chromecasts = targets.filter((x) => x.kind === "chromecast");
  const tvs = targets.filter((x) => x.kind === "dlna");
  const rows: React.ReactNode[] = [];

  if (phase !== "idle" && castKind === "chromecast" && caps.chromecast && !caps.chromecastNativeList) {
    rows.push(
      <DeviceRow
        key="cc-current"
        label={castDeviceLabel(castName, castKind)}
        checked={phase === "connected"}
        busy={phase === "connecting"}
        hint={t("components.music.DevicePicker.stop")}
        hintMuted
        onPress={() => endCast({ resumeHere: true, stopTv: true })}
      />,
    );
  } else if (caps.chromecast && !caps.chromecastNativeList) {
    rows.push(
      <DeviceRow
        key="cc-web"
        label={t("components.music.DevicePicker.chromecast")}
        hint={t("components.music.DevicePicker.chromecastHint")}
        hintMuted
        busy={phase === "connecting" && castKind === "chromecast"}
        onPress={() => {
          if (phase !== "idle") endCast({ resumeHere: false, stopTv: true });
          void requestWebCastSession();
          onPicked?.();
        }}
      />,
    );
  }
  for (const target of chromecasts) {
    rows.push(
      <DeviceRow
        key={target.id}
        label={castDeviceLabel(target.name, "chromecast")}
        checked={isCurrent(target) && phase === "connected"}
        busy={isCurrent(target) && phase === "connecting"}
        onPress={() => pick(target)}
      />,
    );
  }
  if (caps.airplay && (Platform.OS === "ios" ? !!RoutePicker : airplayAvailable)) {
    rows.push(
      <DeviceRow
        key="airplay"
        label={airplayRoute ? castDeviceLabel(airplayRoute, "airplay") : t("components.music.DevicePicker.airplay")}
        hint={airplayRoute ? null : t("components.music.DevicePicker.airplayHint")}
        hintMuted
        checked={!!airplayRoute}
        onPress={RoutePicker ? () => undefined : () => void showAirplayPickerWeb()}
        overlay={
          RoutePicker ? (
            <RoutePicker style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          ) : null
        }
      />,
    );
  }
  for (const target of tvs) {
    rows.push(
      <DeviceRow
        key={target.id}
        label={castDeviceLabel(target.name, "dlna")}
        hint={target.detail ?? null}
        hintMuted
        checked={isCurrent(target) && phase === "connected"}
        busy={isCurrent(target) && phase === "connecting"}
        onPress={() => pick(target)}
      />,
    );
  }
  if (caps.dlna) {
    rows.push(
      <DeviceRow
        key="dlna-search"
        label={
          searching
            ? t("components.music.DevicePicker.searching")
            : tvs.length === 0
              ? t("components.music.DevicePicker.noTvs")
              : t("components.music.DevicePicker.searchAgain")
        }
        hint={tvs.length === 0 && !searching ? t("components.music.DevicePicker.searchAgain") : null}
        hintMuted
        disabled={searching}
        onPress={search}
      />,
    );
  }

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: tokens.border }}>
      <SectionTitle text={t("components.music.DevicePicker.tvs")} />
      {rows.map((row, i) => (i === 0 ? React.cloneElement(row as React.ReactElement<{ first?: boolean }>, { first: true }) : row))}
      {error ? (
        <Text style={{ color: tokens.mutedForeground, fontSize: 12, paddingHorizontal: 16, paddingVertical: 8 }}>
          {error === "connect_failed"
            ? t("components.music.DevicePicker.castFailed")
            : t("components.music.DevicePicker.loadFailed")}
        </Text>
      ) : null}
    </View>
  );
};

export interface DevicePickerSheetProps {
  visible: boolean;
  onClose: () => void;
}

export const DevicePickerSheet = ({ visible, onClose }: DevicePickerSheetProps) => (
  <BottomSheet visible={visible} onClose={onClose}>
    <DevicePickerBody onTransfer={onClose} />
  </BottomSheet>
);

// ---------------------------------------------------------------------------
// Cast button (MiniPlayer pill slot + Now Playing)
// ---------------------------------------------------------------------------

/**
 * Trigger tint per the web: muted when nobody is active, `primary` when we
 * are the active device, emerald when another device plays.
 */
export const CastButton = () => {
  const { tokens } = useTheme();
  const t = useT();
  const fallback = useFallbackLabel();
  const role = useRemoteStore((s) => s.role);
  const activeDeviceId = useRemoteStore((s) => s.activeDeviceId);
  const activeDevice = useRemoteStore(selectActiveDevice);
  const [open, setOpen] = useState(false);
  const casting = useCastStore((s) => s.phase !== "idle");
  const castName = useCastStore((s) => s.deviceName);
  const castKind = useCastStore((s) => s.kind);
  const airplayRoute = useCastStore((s) => s.airplayRoute);
  const caps = castCapabilities();

  // Sem sessão não há aparelhos da app, mas pode haver TVs.
  if (role === "offline" && !casting && !caps.chromecast && !caps.airplay && !caps.dlna) return null;

  const tint =
    activeDeviceId === null && !casting && !airplayRoute
      ? tokens.mutedForeground
      : tokens.foreground;

  return (
    <>
      <GhostIconButton
        icon="cast"
        size={18}
        color={tint}
        accessibilityLabel={
          casting
            ? t("components.music.DevicePicker.playingOn", { device: castDeviceLabel(castName, castKind) })
            : airplayRoute
              ? t("components.music.DevicePicker.playingOn", { device: castDeviceLabel(airplayRoute, "airplay") })
              : activeDevice
                ? t("components.music.DevicePicker.playingOn", {
                    device: deviceDisplayLabel(activeDevice, fallback),
                  })
                : t("components.music.DevicePicker.cast")
        }
        onPress={() => setOpen(true)}
        style={{ width: 36, height: 36 }}
      />
      <DevicePickerSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
};

// ---------------------------------------------------------------------------
// Controller strip (overlay slot, above the MiniPlayer pill)
// ---------------------------------------------------------------------------

/**
 * Height of the ATTACHED strip, exported so the desktop shell can grow its
 * transport row by exactly this much instead of guessing.
 */
export const CONTROLLER_STRIP_HEIGHT = 28;

/**
 * "A tocar em X": uma linha calma, cinzenta, com o ícone pequeno de
 * aparelhos (redesenho 2026-11-04; era uma faixa verde-esmeralda). Tocar
 * abre a lista de aparelhos.
 *
 * FLUTUANTE (telemóvel): colada por cima do mini-leitor, com o mesmo fundo e
 * os cantos de cima redondos; o mini-leitor endireita os dele
 * (`attachedTop`), e os dois leem-se como uma peça só.
 * ATTACHED (computador): rente ao cartão do transporte, largura toda.
 */
const ControllerStripBody = ({ attached = false }: { attached?: boolean }) => {
  const t = useT();
  const { tokens } = useTheme();
  const fallback = useFallbackLabel();
  const activeDevice = useRemoteStore(selectActiveDevice);
  const castPhase = useCastStore((s) => s.phase);
  const castName = useCastStore((s) => s.deviceName);
  const castKind = useCastStore((s) => s.kind);
  const airplayRoute = useCastStore((s) => s.airplayRoute);
  const [open, setOpen] = useState(false);
  const device =
    castPhase === "connecting"
      ? `${castDeviceLabel(castName, castKind)} · ${t("components.music.DevicePicker.connecting")}`
      : castPhase === "connected"
        ? castDeviceLabel(castName, castKind)
        : airplayRoute
          ? castDeviceLabel(airplayRoute, "airplay")
          : deviceDisplayLabel(activeDevice, fallback);
  const label = t("components.music.BottomBar.playingOn", { device });

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          backgroundColor: pressed ? tokens.secondary : tokens.card,
          borderColor: tokens.border,
          borderLeftWidth: attached ? 0 : 1,
          borderRightWidth: attached ? 0 : 1,
          borderTopWidth: 1,
          borderTopLeftRadius: attached ? 0 : 12,
          borderTopRightRadius: attached ? 0 : 12,
          paddingHorizontal: 14,
          height: CONTROLLER_STRIP_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        })}
      >
        <Icon name="cast" size={13} color={tokens.mutedForeground} />
        <Text
          numberOfLines={1}
          style={{ color: tokens.mutedForeground, fontSize: 12, fontWeight: "500", flex: 1 }}
        >
          {label}
        </Text>
      </Pressable>
      <DevicePickerSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
};

export const ControllerStrip = () => <ControllerStripBody />;
export const ControllerStripAttached = () => <ControllerStripBody attached />;

/** Overlay slot consumed by the shell host (WP2). */
export const controllerStripSlot: OverlaySlot = {
  // Também enquanto uma TV (ou o AirPlay) tem o som: "A tocar em Sala (Chromecast)".
  isActive: () => {
    const cast = castStore.getState();
    return remoteStore.getState().role === "controller" || cast.phase !== "idle" || cast.airplayRoute !== null;
  },
  subscribe: (cb: () => void) => {
    const a = remoteStore.subscribe(cb);
    const b = castStore.subscribe(cb);
    return () => {
      a();
      b();
    };
  },
  Component: ControllerStrip,
  Attached: ControllerStripAttached,
};
