/**
 * DevicePicker surfaces (FR-111 UI half): the cast button that lives in the
 * MiniPlayer pill and Now Playing, the emerald "playing on X" controller
 * strip, and the bottom sheet listing devices.
 *
 * Sheet contents, in the web's order:
 *  - "Play here" = transfer to OUR device id (disabled while already active);
 *  - every ONLINE other device as a transfer target, with a check on the
 *    active one and a "needs a tap" hint when it reported activation_blocked;
 *  - offline recents as disabled rows (display-only: transfer requires an
 *    online registry row).
 *
 * The picker is hidden entirely while `role === "offline"` (logged out, or
 * no snapshot ever received): there is nothing to cast to.
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useT } from "@/i18n";
import { AA_LARGE, ON_DARK, preferredOn } from "@/theme/contrast";
import { EMERALD, RADIUS } from "@/theme/tokens";
import { useTheme } from "@/theme/provider";
import { GhostIconButton, Icon, BottomSheet, type IconName } from "@/ui";
import { remoteTransferTo } from "@/remote/channel";
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

/**
 * The strip keeps its emerald identity in both schemes (web parity:
 * `bg-emerald-600 text-white`), so the ink is resolved against EMERALD rather
 * than taken from the token palette. Bold 12px on emerald-600 lands at ~3.8:1
 * - above the non-text bar, below AA for body copy; deepening the emerald
 * would be an identity change, so the brand ink stands.
 */
const STRIP_INK = preferredOn(EMERALD, ON_DARK, AA_LARGE);

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
  hint,
  first,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  checked?: boolean;
  online?: boolean;
  hint?: string | null;
  first?: boolean;
}) => {
  const { tokens, ink } = useTheme();
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
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      <Icon name={DEVICE_ICON} size={20} color={tokens.mutedForeground} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}>
          {label}
        </Text>
        {hint ? (
          <Text style={{ color: ink.sync, fontSize: 11 }}>{hint}</Text>
        ) : null}
      </View>
      {checked ? (
        <Icon name="check" size={18} color={tokens.primary} />
      ) : online ? (
        <View
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ink.sync }}
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

  // Self is matched by id (the wire carries no is_self) and folded into
  // "Play here" instead of being listed twice.
  const onlineOthers = devices.filter((d) => d.online && d.id !== yourDeviceId);
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
        {onlineOthers.map((device) => (
          <DeviceRow
            key={device.id}
            label={deviceDisplayLabel(device, fallback)}
            disabled={!ready}
            checked={device.id === activeDeviceId}
            online
            hint={
              device.id === blockedDeviceId
                ? t("components.music.DevicePicker.needsInteraction")
                : null
            }
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
  const { tokens, ink } = useTheme();
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
      : role === "active"
        ? tokens.primary
        : ink.sync;

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

/** Emerald "Playing on X" bar; tapping it opens the picker. */
export const ControllerStrip = () => {
  const t = useT();
  const fallback = useFallbackLabel();
  const activeDevice = useRemoteStore(selectActiveDevice);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          backgroundColor: EMERALD,
          borderRadius: RADIUS,
          paddingHorizontal: 12,
          paddingVertical: 6,
          marginBottom: 6,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Icon name="cast" size={14} color={STRIP_INK} />
        <Text
          numberOfLines={1}
          style={{ color: STRIP_INK, fontSize: 12, fontWeight: "700", flex: 1 }}
        >
          {t("components.music.DevicePicker.playingOn", {
            device: deviceDisplayLabel(activeDevice, fallback),
          })}
        </Text>
      </Pressable>
      <DevicePickerSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
};

/** Overlay slot consumed by the shell host (WP2). */
export const controllerStripSlot: OverlaySlot = {
  isActive: () => remoteStore.getState().role === "controller",
  subscribe: (cb: () => void) => remoteStore.subscribe(cb),
  Component: ControllerStrip,
};
