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
import { Pressable, Text, View } from "react-native";
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
      ) : online ? (
        <View
          style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tokens.foreground }}
        />
      ) : null}
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

  const transfer = (deviceId: string): void => {
    remoteTransferTo(deviceId);
    onTransfer?.();
  };

  return (
    <>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 4 }}>
        <Text style={{ color: tokens.foreground, fontSize: 18, fontWeight: "800" }}>
          {t("components.music.DevicePicker.devices")}
        </Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
          {activeDevice
            ? `${t("components.music.DevicePicker.playingOnLabel")} ${deviceDisplayLabel(
                activeDevice,
                fallback,
              )}`
            : t("components.music.DevicePicker.noActiveDevice")}
        </Text>
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: tokens.border }}>
        {yourDeviceId ? (
          <DeviceRow
            first
            label={t("components.music.DevicePicker.playHere")}
            disabled={!ready || role === "active"}
            checked={role === "active"}
            onPress={() => transfer(yourDeviceId)}
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
    </>
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

  if (role === "offline") return null;

  const tint =
    activeDeviceId === null
      ? tokens.mutedForeground
      : tokens.foreground;

  return (
    <>
      <GhostIconButton
        icon="cast"
        size={18}
        color={tint}
        accessibilityLabel={
          activeDevice
            ? t("components.music.DevicePicker.playingOn", {
                device: deviceDisplayLabel(activeDevice, fallback),
              })
            : t("components.music.DevicePicker.noActiveDevice")
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
  const [open, setOpen] = useState(false);
  const label = t("components.music.BottomBar.playingOn", {
    device: deviceDisplayLabel(activeDevice, fallback),
  });

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
  isActive: () => remoteStore.getState().role === "controller",
  subscribe: (cb: () => void) => remoteStore.subscribe(cb),
  Component: ControllerStrip,
  Attached: ControllerStripAttached,
};
