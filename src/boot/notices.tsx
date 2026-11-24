/**
 * Global notice host (WP12 integration).
 *
 * Four subsystems emit user-visible messages as i18n KEYS through registered
 * handlers so they never import a UI surface:
 *   - player/recovery.ts   throttled "song unavailable, skipped" (FR-61)
 *   - downloads/notices.ts WiFi refusal + enqueue failures (FR-88)
 *   - jam/notices.ts       jam lifecycle, proposals, votes (FR-113..118)
 *   - remote/register.ts   no active device / device needs a tap (FR-111)
 * Until boot registers a real handler each of them only console.warns. This
 * module is that handler plus the surface that renders it, mounted as a shell
 * provider from boot/wireup.ts (innermost provider, so it floats above every
 * screen including the auth stack).
 *
 * Copy is translated at RENDER time (keys + params are stored), so a language
 * change while a notice is on screen relabels it.
 */
import React, { useCallback, useEffect, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { setDownloadNoticeHandler } from "@/downloads/notices";
import { setJamNoticeHandler } from "@/jam/notices";
import { setPlayerToastHandler } from "@/player/recovery";
import { setRemoteNoticeHandler } from "@/remote/register";
import { useT } from "@/i18n";
import { dismissNotice, getNotices, pushNotice, subscribeNotices, type Notice } from "@/lib/noticeBus";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";

const VISIBLE_MS = 4200;

let handlersRegistered = false;

/** Idempotent; boot/wireup.ts calls it once. */
export const registerNoticeHandlers = (): void => {
  if (handlersRegistered) return;
  handlersRegistered = true;
  setPlayerToastHandler((key) => pushNotice(key));
  setDownloadNoticeHandler((key) => pushNotice(key));
  setJamNoticeHandler((notice) => pushNotice(notice.key, notice.params));
  setRemoteNoticeHandler((message) => pushNotice(message.key, message.params));
};

const NoticeCard = ({ notice }: { notice: Notice }) => {
  const { tokens } = useTheme();
  const t = useT();
  const dismiss = useCallback(() => dismissNotice(notice.id), [notice.id]);

  useEffect(() => {
    const timer = setTimeout(dismiss, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [dismiss]);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={dismiss}
      style={{
        backgroundColor: tokens.popover,
        borderColor: tokens.border,
        borderWidth: 1,
        borderRadius: RADIUS + 4,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <Text style={{ color: tokens.popoverForeground, fontSize: 14 }}>
        {t(notice.key, notice.params)}
      </Text>
    </Pressable>
  );
};

const NoticeStack = () => {
  const insets = useSafeAreaInsets();
  // The store hands out a NEW array on every change and the same one in
  // between, which is exactly the useSyncExternalStore contract.
  const visible = useSyncExternalStore(subscribeNotices, getNotices, getNotices);

  if (visible.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        top: insets.top + 8,
        left: 12,
        right: 12,
        gap: 8,
      }}
    >
      {visible.map((notice) => (
        <NoticeCard key={notice.id} notice={notice} />
      ))}
    </View>
  );
};

/** Shell provider: passes children through and floats the notice stack. */
export const NoticeHost = ({ children }: { children?: React.ReactNode }) => (
  <View style={{ flex: 1 }}>
    {children}
    <NoticeStack />
  </View>
);
