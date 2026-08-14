/**
 * "A tocar" tenant of the desktop right panel (plano-uma-so-app 4.3
 * amendment): a LEAN Spotify-style column, not the mobile player. The
 * transport bar under the grid already owns play/seek/volume, so this
 * surface renders none of them - duplicated controls in a 320px column was
 * exactly the screenshot complaint. Top to bottom:
 *
 *  - artwork sized to the panel width;
 *  - title + artists (links into the main pane) + like + the song menu;
 *  - the About-the-artist card, embedded (plain push, no modal to unwind);
 *  - song credits when the payload carries `artists` entries (the same
 *    grouping the credits dialog renders, inline and photo-less);
 *  - a compact "A seguir" preview of the next queue entries whose "Ver
 *    fila" hands over to the queue tenant.
 *
 * One scrollable column; the mobile (player) modal keeps the full
 * NowPlayingScroll composition untouched.
 */
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useLikedIds, useToggleLike } from "@/api/queries/likedSongs";
import { getTransport } from "@/contracts/transport";
import { songArtworkSource } from "@/domain/artwork";
import {
  featuredArtists,
  formatArtists,
  primaryArtists,
  primaryArtistSegment,
  withArtists,
} from "@/domain/format";
import type { Song, SongArtistEntry } from "@/domain/song";
import { useT } from "@/i18n";
import { songAlbumRoute, songArtistRoute } from "@/lib/routes";
import { usePlaybackView } from "@/remote/mirror";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ArtworkImage, EmptyState, GhostIconButton, SongMenu, useContainerWidth } from "@/ui";
import { AboutArtistCard } from "./aboutArtistCard";

const NP = "components.music.NowPlayingSheet";
const BB = "components.music.BottomBar";
const CREDITS = "components.music.SongCreditsDialog";

/** How many upcoming songs the preview shows before deferring to the queue. */
const UP_NEXT_PREVIEW = 3;

/** One credits group, inline: the dialog's grouping without its modal. */
const CreditsGroup = ({ label, entries }: { label: string; entries: SongArtistEntry[] }) => {
  const { tokens } = useTheme();
  if (entries.length === 0) return null;
  return (
    <View style={{ gap: 2 }}>
      <Text
        style={{
          color: tokens.mutedForeground,
          fontSize: 11,
          fontWeight: "700",
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        {label}
      </Text>
      {entries.map((entry) => (
        <Text
          key={entry.id}
          style={{ color: tokens.foreground, fontSize: 14, marginTop: 2 }}
          numberOfLines={1}
        >
          {entry.name}
        </Text>
      ))}
    </View>
  );
};

/**
 * Credits card, only when the song actually carries artist entries - the
 * same condition that gates the menu's credits item, so the panel never
 * shows an empty "Créditos" shell.
 */
const PanelCredits = ({ song }: { song: Song }) => {
  const t = useT();
  const { tokens } = useTheme();
  if ((song.artists ?? []).length === 0) return null;
  return (
    <View
      style={{
        borderRadius: RADIUS * 2,
        backgroundColor: tokens.secondary,
        padding: 16,
        gap: 12,
      }}
    >
      <Text style={{ color: tokens.foreground, fontSize: 15, fontWeight: "800" }}>
        {t(`${CREDITS}.title`)}
      </Text>
      <CreditsGroup label={t(`${CREDITS}.rolePrimary`)} entries={primaryArtists(song)} />
      <CreditsGroup label={t(`${CREDITS}.roleFeatured`)} entries={featuredArtists(song)} />
      <CreditsGroup label={t(`${CREDITS}.roleWith`)} entries={withArtists(song)} />
    </View>
  );
};

/**
 * Compact "A seguir" preview: the next few VISIBLE queue entries (the same
 * order the queue tenant lists), each row a jump, the header's "Ver fila" a
 * tenant switch - the queue tenant remains the place for reorder/remove.
 */
const UpNextPreview = ({ onOpenQueue }: { onOpenQueue: () => void }) => {
  const t = useT();
  const { tokens } = useTheme();
  const queue = usePlaybackView((v) => v.queue);
  const queueOrder = usePlaybackView((v) => v.queueOrder);
  const queueIndex = usePlaybackView((v) => v.queueIndex);

  // Visible order after the current row: what plays next under shuffle too.
  const next = useMemo(
    () =>
      queueOrder
        .slice(queueIndex + 1, queueIndex + 1 + UP_NEXT_PREVIEW)
        .map((backingIndex, offset) => ({
          song: queue[backingIndex],
          visibleIndex: queueIndex + 1 + offset,
        }))
        .filter((entry): entry is { song: Song; visibleIndex: number } => entry.song != null),
    [queue, queueOrder, queueIndex],
  );

  if (next.length === 0) return null;

  return (
    <View
      style={{
        borderRadius: RADIUS * 2,
        backgroundColor: tokens.secondary,
        padding: 16,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ color: tokens.foreground, fontSize: 15, fontWeight: "800", flex: 1 }}>
          {t("native.player.upNext")}
        </Text>
        <Pressable
          onPress={onOpenQueue}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={{ color: tokens.mutedForeground, fontSize: 12, fontWeight: "700" }}>
            {t("native.desktop.viewQueue")}
          </Text>
        </Pressable>
      </View>
      {next.map(({ song, visibleIndex }) => (
        <Pressable
          key={`${song.id}:${visibleIndex}`}
          onPress={() => getTransport().setQueueIndex(visibleIndex)}
          accessibilityRole="button"
          accessibilityLabel={song.title}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <ArtworkImage
            source={songArtworkSource(song)}
            songId={song.id}
            size={40}
            recyclingKey={String(song.id)}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600" }}
              numberOfLines={1}
            >
              {song.title}
            </Text>
            <Text style={{ color: tokens.mutedForeground, fontSize: 12 }} numberOfLines={1}>
              {formatArtists(song)}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
};

export interface PanelNowPlayingProps {
  /** Switch the panel to the queue tenant (the "Ver fila" affordance). */
  onOpenQueue: () => void;
}

export const PanelNowPlaying = ({ onOpenQueue }: PanelNowPlayingProps) => {
  const t = useT();
  const { tokens } = useTheme();
  const router = useRouter();
  // The panel's ContainerWidthProvider carries the COLUMN width, so the
  // artwork sizes against the panel, never the window.
  const containerWidth = useContainerWidth();

  const song = usePlaybackView((v) => v.song);
  const likedIds = useLikedIds();
  const toggleLike = useToggleLike();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!song) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <EmptyState icon="music" text={t("components.music.QueuePanel.empty")} />
      </View>
    );
  }

  const artistsLine = formatArtists(song) || t(`${NP}.unknownArtist`);
  const artistSegment = primaryArtistSegment(song);
  const liked = (likedIds.data ?? []).includes(song.id);
  const artworkSize = Math.max(1, containerWidth - 32);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 14 }}
      showsVerticalScrollIndicator={false}
    >
      <ArtworkImage
        source={songArtworkSource(song)}
        songId={song.id}
        size={artworkSize}
        borderRadius={12}
      />

      {/* Title + artists are links into the main pane; embedded semantics
          mean a plain push (no player modal above the stack to unwind). */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t("components.music.Song.album")}
            disabled={!song.album || !artistSegment}
            onPress={() => router.push(songAlbumRoute(song))}
          >
            <Text
              numberOfLines={2}
              style={{ color: tokens.foreground, fontSize: 18, fontWeight: "800" }}
            >
              {song.title}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t("components.music.Song.artist")}
            disabled={!artistSegment}
            onPress={() => router.push(songArtistRoute(song))}
          >
            <Text
              numberOfLines={1}
              style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 2 }}
            >
              {artistsLine}
            </Text>
          </Pressable>
        </View>
        <GhostIconButton
          icon="heart"
          active={liked}
          filled={liked}
          size={18}
          accessibilityLabel={liked ? t(`${BB}.unlike`) : t(`${BB}.like`)}
          onPress={() => toggleLike.mutate({ songId: song.id, liked })}
        />
        <GhostIconButton
          icon="more-horizontal"
          size={18}
          accessibilityLabel={t(`${NP}.moreActions`)}
          onPress={() => setMenuOpen(true)}
        />
      </View>

      {/* The about-the-artist card ships its own 16px margins for the
          mobile scroll; inside the padded panel column those would double
          up, so the negative wrapper margins re-align it with the artwork
          (and swallow the card's own top margin into the column gap). */}
      <View style={{ marginHorizontal: -16, marginTop: -12 }}>
        <AboutArtistCard embedded />
      </View>

      <PanelCredits song={song} />

      <UpNextPreview onOpenQueue={onOpenQueue} />

      {/* Mounted on demand (SongRow's idiom) so the closed menu leaves no
          phantom slot in the column's gap arithmetic. */}
      {menuOpen ? (
        <SongMenu
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          context={{ song, surface: "nowPlaying" }}
        />
      ) : null}
    </ScrollView>
  );
};
