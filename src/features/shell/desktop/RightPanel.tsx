/**
 * Right panel (plano-uma-so-app 4.3, rows "Player sheet" and "Queue"): ONE
 * slot, FIVE tenants - Now Playing, Queue, Lyrics, Devices, Friend activity -
 * behind ONE persisted key (layoutPrefs).
 *
 *  - Now Playing is `PanelNowPlaying`, a lean column built FOR the panel
 *    (artwork, title row, artist card, credits, up-next preview) - never the
 *    mobile player, whose transport would duplicate the bar right below;
 *  - Queue / Lyrics / Friends are the (player) pager bodies as-is;
 *  - Devices is the DevicePicker's body outside its bottom sheet (a 2560px
 *    drawer for five rows is exactly what the plan is killing).
 *
 * The panel content sits inside a ContainerWidthProvider carrying the PANEL
 * width, so container-based sizing (artwork, table gates) reads ~300px here
 * while the main pane keeps its own provider - two independent containers,
 * one breakpoints module.
 *
 * Forms by window width: >= 1200px and open, the real column; >= 1200px and
 * closed, a 32px rail whose icons reopen straight into a tenant; 900-1200px,
 * the rail is geometry only (the tenants live behind the transport-bar
 * routes there). The maximize button opens the desktop cinema overlay
 * (features/player/cinema) - the (player) modal remains the MOBILE player.
 *
 * Web-only by construction: only DesktopShell.web.tsx imports this file.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { DevicePickerBody } from "@/features/devices/DevicePicker";
import FriendsBody from "@/features/friends";
import LyricsBody from "@/features/lyrics";
import { openCinema } from "@/features/player/cinema";
import { PanelNowPlaying } from "@/features/player/panelNowPlaying";
import QueueBody from "@/features/player/queue";
import { useT } from "@/i18n";
import { useRemoteStore } from "@/remote/store";
import { useTheme } from "@/theme/provider";
import { ContainerWidthProvider, EmptyState, GhostIconButton, type IconName } from "@/ui";
import { RIGHT_PANEL_TENANTS, type RightPanelTenant } from "./rightPanelModel";

const TENANT_ICONS: Record<RightPanelTenant, IconName> = {
  nowPlaying: "disc",
  queue: "list-music",
  lyrics: "mic-vocal",
  devices: "cast",
  friends: "users",
};

const TENANT_LABEL_KEYS: Record<RightPanelTenant, string> = {
  nowPlaying: "native.desktop.tenantNowPlaying",
  queue: "native.desktop.tenantQueue",
  lyrics: "native.desktop.tenantLyrics",
  devices: "native.desktop.tenantDevices",
  friends: "native.desktop.tenantFriends",
};

/**
 * Devices tenant: the picker body, scrollable, with the picker's own hidden
 * state honoured - `role === "offline"` means there is nothing to cast to,
 * which the CastButton expresses by not existing; a panel cannot not exist,
 * so it says so instead.
 */
const DevicesTenant = () => {
  const t = useT();
  const role = useRemoteStore((s) => s.role);
  if (role === "offline") {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <EmptyState icon="cast" text={t("components.music.DevicePicker.noActiveDevice")} />
      </View>
    );
  }
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8 }}>
      <DevicePickerBody />
    </ScrollView>
  );
};

const TenantBody = ({
  tenant,
  onSelectTenant,
}: {
  tenant: RightPanelTenant;
  onSelectTenant: (tenant: RightPanelTenant) => void;
}) => {
  switch (tenant) {
    case "nowPlaying":
      return <PanelNowPlaying onOpenQueue={() => onSelectTenant("queue")} />;
    case "queue":
      return (
        <View style={{ flex: 1, paddingTop: 12 }}>
          <QueueBody />
        </View>
      );
    case "lyrics":
      return <LyricsBody />;
    case "devices":
      return <DevicesTenant />;
    case "friends":
      return (
        <View style={{ flex: 1, paddingTop: 12 }}>
          <FriendsBody />
        </View>
      );
  }
};

export interface DesktopRightPanelProps {
  /** Window fits the real column (>= 1200px). */
  wide: boolean;
  /** Column form requested (only honoured while `wide`). */
  open: boolean;
  tenant: RightPanelTenant;
  /** Panel column width in px - the container width for the tenants. */
  width: number;
  onSelectTenant: (tenant: RightPanelTenant) => void;
  onClose: () => void;
}

export const DesktopRightPanel = ({
  wide,
  open,
  tenant,
  width,
  onSelectTenant,
  onClose,
}: DesktopRightPanelProps) => {
  const { tokens } = useTheme();
  const t = useT();

  // 900-1200px: geometry-only rail, nothing to interact with (the plan's
  // collapse order folds the panel first, and the transport bar still routes
  // to the full-screen queue and player).
  if (!wide) return <View style={{ flex: 1 }} />;

  // Closed rail at >= 1200px: each tenant icon is a door straight back in.
  if (!open) {
    return (
      <View style={{ flex: 1, alignItems: "center", paddingTop: 8, gap: 2 }}>
        {RIGHT_PANEL_TENANTS.map((item) => (
          <GhostIconButton
            key={item}
            icon={TENANT_ICONS[item]}
            size={14}
            accessibilityLabel={t(TENANT_LABEL_KEYS[item])}
            onPress={() => onSelectTenant(item)}
            style={{ width: 28, height: 32 }}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Header: the five tenant toggles, then cinema + close. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 6,
          paddingVertical: 4,
          gap: 0,
          borderBottomWidth: 1,
          borderBottomColor: tokens.border,
        }}
      >
        {RIGHT_PANEL_TENANTS.map((item) => (
          <GhostIconButton
            key={item}
            icon={TENANT_ICONS[item]}
            size={16}
            active={item === tenant}
            accessibilityLabel={t(TENANT_LABEL_KEYS[item])}
            onPress={() => onSelectTenant(item)}
            style={{ width: 34, height: 36 }}
          />
        ))}
        <View style={{ flex: 1 }} />
        {/* Cinema mode: the desktop overlay above the shell (the transport
            bar stays visible under it) - the same surface the bar's own
            fullscreen button opens, never the mobile modal. */}
        <GhostIconButton
          icon="maximize-2"
          size={14}
          accessibilityLabel={t("native.desktop.cinemaMode")}
          onPress={openCinema}
          style={{ width: 30, height: 36 }}
        />
        <GhostIconButton
          icon="x"
          size={16}
          accessibilityLabel={t("components.music.QueuePanel.close")}
          onPress={onClose}
          style={{ width: 30, height: 36 }}
        />
      </View>

      {/* Tenants size against the PANEL, not the window: artwork, tables and
          every container breakpoint read ~300px here. */}
      <View style={{ flex: 1, minHeight: 0 }}>
        <ContainerWidthProvider width={width}>
          <TenantBody tenant={tenant} onSelectTenant={onSelectTenant} />
        </ContainerWidthProvider>
      </View>
    </View>
  );
};
