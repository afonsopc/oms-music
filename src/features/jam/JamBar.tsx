/**
 * JamBar (FR-116 shell half): replaces the MiniPlayer pill while FOLLOWING a
 * jam. A follower has no queue of their own here and cannot seek - the host
 * drives - so the bar carries song info, live progress, a LOCAL pause (which
 * rejoins live on resume), a skip vote, the jam panel and leave.
 *
 * Proposing is deliberately not a control: while the jam accepts proposals,
 * pressing play on any song in the library proposes it (the playback
 * interceptor, jam/interceptor.ts).
 */
import React from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useT } from "@/i18n";
import { jamLeave, jamToggleLocalPause, jamVoteSkip } from "@/jam/channel";
import {
  jamStore,
  selectCanVoteSkip,
  selectFollowing,
  useJamStore,
} from "@/jam/store";
import { artistNamesLine, formatSnapshotDuration } from "@/social/display";
import type { OverlaySlot } from "@/features/shell/slots";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ArtworkImage, GhostIconButton, Icon, backgroundVeil, heavyShadow } from "@/ui";

const BAR = "components.music.JamBar";

export const JamBar = () => {
  const t = useT();
  const { tokens, scheme } = useTheme();
  const song = useJamStore((s) => s.state?.song ?? null);
  const hostPaused = useJamStore((s) => s.state?.paused ?? true);
  const localPaused = useJamStore((s) => s.localPaused);
  const position = useJamStore((s) => s.followerPosition);
  const skipVotes = useJamStore((s) => s.skipVotes);
  const canVoteSkip = useJamStore(selectCanVoteSkip);

  const playing = !hostPaused && !localPaused;
  const duration = song?.duration ?? 0;
  const progress = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;

  return (
    <View
      style={[
        {
          height: 64,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: tokens.border,
          backgroundColor: backgroundVeil(scheme, 0.95),
          overflow: "hidden",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 10,
        },
        heavyShadow,
      ]}
    >
      {song?.artwork_url ? (
        <ArtworkImage uri={song.artwork_url} size={40} />
      ) : (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: RADIUS,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: tokens.muted,
          }}
        >
          <Icon name="radio" size={18} color={tokens.mutedForeground} />
        </View>
      )}

      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="radio" size={11} color={tokens.primary} />
          <Text style={{ color: tokens.primary, fontSize: 10, fontWeight: "800" }}>
            {t(`${BAR}.followingJam`)}
          </Text>
          {hostPaused ? (
            <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 10 }}>
              {t(`${BAR}.hostPaused`)}
            </Text>
          ) : null}
        </View>
        {song ? (
          <>
            <Text
              numberOfLines={1}
              style={{ color: tokens.foreground, fontSize: 13, fontWeight: "600" }}
            >
              {song.title}
            </Text>
            <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 11 }}>
              {artistNamesLine(song.artist_names)}
              {duration > 0
                ? `  ${formatSnapshotDuration(position)} / ${formatSnapshotDuration(duration)}`
                : ""}
            </Text>
          </>
        ) : (
          <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 12 }}>
            {t(`${BAR}.waitingForHost`)}
          </Text>
        )}
      </View>

      <GhostIconButton
        icon={playing ? "pause" : "play"}
        filled
        size={17}
        disabled={hostPaused}
        accessibilityLabel={t(localPaused ? `${BAR}.resume` : `${BAR}.pauseForMe`)}
        onPress={jamToggleLocalPause}
        style={{ width: 34, height: 44 }}
      />
      {canVoteSkip && song ? (
        <View style={{ alignItems: "center" }}>
          <GhostIconButton
            icon="skip-forward"
            size={17}
            accessibilityLabel={t(`${BAR}.voteSkip`)}
            onPress={() => void jamVoteSkip()}
            style={{ width: 30, height: 44 }}
          />
          {skipVotes ? (
            <Text
              style={{
                position: "absolute",
                bottom: 2,
                color: tokens.mutedForeground,
                fontSize: 9,
                fontVariant: ["tabular-nums"],
              }}
            >
              {skipVotes.count}/{skipVotes.needed}
            </Text>
          ) : null}
        </View>
      ) : null}
      <GhostIconButton
        icon="users"
        size={17}
        accessibilityLabel={t(`${BAR}.jamMembers`)}
        onPress={() => router.push("/jam")}
        style={{ width: 30, height: 44 }}
      />
      <GhostIconButton
        icon="x"
        size={17}
        accessibilityLabel={t(`${BAR}.leaveJam`)}
        onPress={() => void jamLeave()}
        style={{ width: 30, height: 44 }}
      />

      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 2,
          backgroundColor: tokens.border,
        }}
      >
        <View
          style={{
            width: `${progress * 100}%`,
            height: 2,
            backgroundColor: tokens.primary,
          }}
        />
      </View>
    </View>
  );
};

/** Overlay slot consumed by the shell host (WP2): replaces the pill. */
export const jamBarSlot: OverlaySlot = {
  isActive: () => selectFollowing(jamStore.getState()),
  subscribe: (cb: () => void) => jamStore.subscribe(cb),
  Component: JamBar,
};
