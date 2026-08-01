/**
 * Dev-only component gallery (WP4 acceptance): renders every UI kit
 * component with sample data in the current theme; the theme rows flip
 * light/dark/system live. Not part of the 28-screen product tree - a
 * route wrapper (dev builds only) mounts this from src/app.
 *
 * Section headings are component names (proper nouns, not user copy);
 * interactive labels reuse the shipped catalogs.
 */
import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActionBar } from "../ActionBar";
import { AlbumCard } from "../AlbumCard";
import { ArtistCard } from "../ArtistCard";
import { ArtworkImage } from "../ArtworkImage";
import { GhostIconButton, PlayFab } from "../buttons";
import { AddToPlaylistDialog } from "../dialogs/AddToPlaylistDialog";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { FilterPills } from "../FilterPills";
import { Hero } from "../Hero";
import { InitialsAvatar } from "../InitialsAvatar";
import { LikedArtwork } from "../LikedArtwork";
import { MiniPlayerPill } from "../MiniPlayerPill";
import { MixTile, mixStampText } from "../MixTile";
import { PlayingBars } from "../PlayingBars";
import { Rail } from "../Rail";
import { SongMenu } from "../SongMenu";
import { SongRow } from "../SongRow";
import { HeroSkeleton, SongTableSkeleton, TileSkeleton } from "../skeletons";
import { StickyTitle } from "../StickyTitle";
import { Tile } from "../Tile";
import { TopTileGrid } from "../TopTileGrid";
import type { MixKind } from "@/domain/mixes";
import type { Song } from "@/domain/song";
import type { SongId, UserId } from "@/domain/ids";
import { useT } from "@/i18n";
import { useTheme, type ThemeMode } from "@/theme/provider";
import { typeScale } from "@/theme/typography";

const makeSong = (id: number, title: string, artist: string, album: string | null): Song => ({
  id: id as SongId,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  title,
  album,
  duration: 187 + id * 7,
  position: null,
  year: 2024,
  audio_fs_node_id: null,
  compressed_audio_fs_node_id: null,
  artwork_fs_node_id: null,
  compressed_artwork_fs_node_id: null,
  vocals_fs_node_id: null,
  instrumental_fs_node_id: null,
  vocal_separation_started_at: id === 3 ? new Date(Date.now() - 95_000).toISOString() : null,
  user_id: "dev" as UserId,
  source_kind: "upload",
  source_provider: null,
  source_url: null,
  source_id: null,
  isrc: null,
  original_filename: null,
  audio_codec: null,
  audio_bitrate_kbps: null,
  audio_sample_rate_hz: null,
  audio_channels: null,
  audio_lossless: null,
  audio_filesize_bytes: null,
  artists: [
    {
      id: id * 10,
      song_id: id,
      artist_id: 1,
      position: 0,
      role: "primary",
      name: artist,
      slug: artist.toLowerCase().replace(/\s+/g, "-"),
      image_fs_node_id: null,
      compressed_image_fs_node_id: null,
      picture: null,
      picture_medium: null,
      external_image_url: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    {
      id: id * 10 + 1,
      song_id: id,
      artist_id: 2,
      position: 1,
      role: "featured",
      name: "Rita Lima",
      slug: "rita-lima",
      image_fs_node_id: null,
      compressed_image_fs_node_id: null,
      picture: null,
      picture_medium: null,
      external_image_url: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ],
});

const SAMPLE_SONGS: Song[] = [
  makeSong(1, "Ainda Bem", "Carlos Paiao", "Obrigado"),
  makeSong(2, "Mar Alto", "Ana Moura", "Desfado"),
  makeSong(3, "Lisboa Menina", "Carlos do Carmo", null),
];

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const { tokens } = useTheme();
  return (
    <View style={{ gap: 12 }}>
      <Text style={[typeScale.sectionHeader, { color: tokens.foreground, paddingHorizontal: 24 }]}>
        {title}
      </Text>
      {children}
    </View>
  );
};

export const GalleryScreen = () => {
  const { tokens, mode, setMode } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const [pill, setPill] = useState("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [sticky, setSticky] = useState(true);
  const noop = () => {};

  if (!__DEV__) return null;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <StickyTitle
        visible={sticky}
        title="Gallery"
        topOffset={0}
        leading={<PlayFab onPress={noop} size={32} accessibilityLabel={t("components.music.ActionBar.play")} />}
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 64,
          paddingBottom: insets.bottom + 120,
          gap: 32,
        }}
      >
        <Section title="Theme">
          <FilterPills
            pills={(["light", "dark", "system"] as ThemeMode[]).map((m) => ({
              key: m,
              label: m,
            }))}
            activeKey={mode}
            onChange={(key) => setMode(key as ThemeMode)}
          />
        </Section>

        <Section title="FilterPills">
          <FilterPills
            pills={[
              { key: "all", label: t("components.music.Search.filterAll") },
              { key: "playlists", label: t("components.music.Search.filterPlaylists") },
              { key: "albums", label: t("components.music.Search.filterAlbums") },
              { key: "artists", label: t("components.music.Search.filterArtists") },
            ]}
            activeKey={pill}
            onChange={setPill}
          />
        </Section>

        <Section title="Buttons">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 24 }}>
            <PlayFab onPress={noop} accessibilityLabel={t("components.music.ActionBar.play")} />
            <PlayFab playing onPress={noop} size={40} accessibilityLabel={t("components.music.ActionBar.pause")} />
            <GhostIconButton icon="shuffle" onPress={noop} accessibilityLabel={t("components.music.ActionBar.shuffle")} />
            <GhostIconButton icon="heart" active filled onPress={noop} accessibilityLabel={t("components.music.ActionBar.like")} />
            <GhostIconButton icon="cloud-check" active onPress={noop} accessibilityLabel={t("components.music.ActionBar.download")} />
            <PlayingBars animate />
            <PlayingBars animate={false} />
          </View>
        </Section>

        <Section title="ArtworkImage / LikedArtwork / InitialsAvatar">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 24 }}>
            <ArtworkImage source={{ kind: "placeholder" }} size={64} />
            <ArtworkImage source={{ kind: "placeholder" }} size={64} shape="circle" />
            <LikedArtwork size={64} />
            <InitialsAvatar name="Carlos Paiao" size={64} />
          </View>
        </Section>

        <Section title="Hero">
          <Hero
            kind="album"
            title="Obrigado"
            meta="Carlos Paiao · 2024 · 12"
            image={{ kind: "placeholder" }}
            accentColor="#7e22ce"
          />
          <Hero kind="artist" title="Ana Moura" image={{ kind: "initials", name: "Ana Moura" }} />
        </Section>

        <Section title="ActionBar">
          <ActionBar
            onPlay={noop}
            onShuffle={noop}
            onStartRadio={noop}
            onToggleOffline={noop}
            isOffline
            menuItems={[
              {
                id: "delete",
                label: t("components.music.PlaylistView.deletePlaylist"),
                icon: "trash",
                destructive: true,
                onPress: () => setConfirmOpen(true),
              },
            ]}
          />
        </Section>

        <Section title="SongRow">
          <View style={{ paddingHorizontal: 12 }}>
            {SAMPLE_SONGS.map((song, i) => (
              <SongRow
                key={song.id}
                song={song}
                index={i}
                addedAt={song.created_at}
                liked={i === 0}
                isCurrent={i === 1}
                isPlaying={i === 1}
                onPlay={noop}
              />
            ))}
          </View>
        </Section>

        <Section title="Tile / MixTile">
          <Rail title="Rail" showAllLabel="Show all" onShowAll={noop}>
            <Tile title="Desfado" subtitle="Ana Moura" artwork={{ kind: "placeholder" }} onPress={noop} onPlay={noop} />
            <Tile title="Ana Moura" artwork={{ kind: "initials", name: "Ana Moura" }} shape="circle" onPress={noop} />
            {(["top_artist", "repeat_rewind", "time_capsule", "discoveries"] as MixKind[]).map(
              (kind) => (
                <MixTile
                  key={kind}
                  kind={kind}
                  title={kind}
                  description="Gallery sample"
                  stamp={mixStampText(kind, kind, "Ana Moura", 2010)}
                  onPress={noop}
                />
              ),
            )}
          </Rail>
        </Section>

        <Section title="TopTileGrid">
          <TopTileGrid
            items={SAMPLE_SONGS.map((s) => ({
              key: String(s.id),
              title: s.album ?? s.title,
              artwork: { kind: "placeholder" },
              onPress: noop,
              onPlay: noop,
            }))}
          />
        </Section>

        <Section title="ArtistCard / AlbumCard">
          <View style={{ flexDirection: "row", gap: 16, paddingHorizontal: 24 }}>
            <ArtistCard name="Carlos Paiao" onPress={noop} />
            <ArtistCard name="A carregar" loading onPress={noop} />
            <AlbumCard name="Desfado" artwork={{ kind: "placeholder" }} onPress={noop} />
          </View>
        </Section>

        <Section title="Skeletons">
          <View style={{ flexDirection: "row", paddingHorizontal: 12 }}>
            <TileSkeleton />
          </View>
          <SongTableSkeleton rows={2} />
          <HeroSkeleton />
        </Section>

        <Section title="EmptyState / ErrorState">
          <EmptyState
            icon="heart"
            text={t("components.music.LikedSongsView.empty")}
            actionLabel={t("native.common.retry")}
            onAction={noop}
          />
          <ErrorState onRetry={noop} />
        </Section>

        <Section title="MiniPlayerPill">
          <View style={{ paddingHorizontal: 16 }}>
            <MiniPlayerPill
              title="Mar Alto"
              artistsLine="Ana Moura (feat. Rita Lima)"
              artwork={{ kind: "placeholder" }}
              playing
              progress={0.4}
              onPress={noop}
              onTogglePlay={noop}
              playLabel={t("components.music.SongRow.play")}
              pauseLabel={t("components.music.SongRow.pause")}
              castSlot={
                <GhostIconButton icon="cast" onPress={noop} accessibilityLabel="cast" />
              }
            />
          </View>
        </Section>

        <Section title="Dialogs">
          <View style={{ flexDirection: "row", gap: 12, paddingHorizontal: 24 }}>
            <GhostIconButton icon="more-horizontal" onPress={() => setMenuOpen(true)} accessibilityLabel={t("components.music.ActionBar.more")} />
            <GhostIconButton icon="trash" onPress={() => setConfirmOpen(true)} accessibilityLabel={t("components.music.PlaylistView.deletePlaylist")} />
            <GhostIconButton icon="library" onPress={() => setAddOpen(true)} accessibilityLabel={t("components.music.AddToPlaylistDialog.title")} />
            <GhostIconButton icon="chevron-down" onPress={() => setSticky((v) => !v)} accessibilityLabel="sticky" />
          </View>
        </Section>
      </ScrollView>

      {menuOpen ? (
        <SongMenu
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          context={{ song: SAMPLE_SONGS[0]!, surface: "row", onPlay: noop }}
        />
      ) : null}
      <ConfirmDialog
        visible={confirmOpen}
        title={t("components.music.PlaylistView.deletePlaylist")}
        message={t("components.music.PlaylistView.areYouSureDeletePlaylist")}
        confirmLabel={t("components.music.PlaylistView.deletePlaylist")}
        destructive
        onConfirm={() => setConfirmOpen(false)}
        onCancel={() => setConfirmOpen(false)}
      />
      <AddToPlaylistDialog
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        songTitle="Mar Alto"
        rows={[
          { id: 1, name: "Favoritas", artwork: { kind: "placeholder" }, memberJoinRowId: 12 },
          { id: 2, name: "Verao 2026", artwork: { kind: "placeholder" }, memberJoinRowId: null },
        ]}
        onToggle={noop}
        onCreateAndAdd={noop}
      />
    </View>
  );
};

export default GalleryScreen;
