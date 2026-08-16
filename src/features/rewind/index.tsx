/**
 * O Rewind (pedido do dono, 2026-08-18): a retrospectiva em formato stories
 * - o StoryPager genérico com cartões de conteúdo por cima dos gradientes
 * dos mixes. v1 assumida: os números vêm dos agregados que a API já serve
 * (top de sempre e 30 dias) - o dono decidiu por mensagem que ter o formato
 * NO AR vale mais do que esperar pela auditoria das contagens (2.4); quando
 * o backend ganhar agregados por ano, só o data-hook muda.
 */
import React, { useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTopArtists, useTopSongsOverall } from "@/api/queries/playEvents";
import { artistDisplayName } from "@/domain/album";
import { artistImageSource, songArtworkSource } from "@/domain/artwork";
import { formatArtists } from "@/domain/format";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { MIX_KIND_GRADIENTS } from "@/theme/tokens";
import { FONT_DRUK_WIDE } from "@/theme/typography";
import {
  ArtworkImage,
  artworkSourceUri,
  StoryPager,
  type StoryCard,
} from "@/ui";
import { gradientBackground, linearGradient } from "@/ui/uiTheme";
import { Image } from "expo-image";

const R = "components.music.Rewind";

/** Fundo de cartão: o gradiente diagonal dos mixes, escurecido no rodapé. */
const CardShell = ({
  colors,
  children,
}: {
  colors: readonly [string, string, string];
  children: React.ReactNode;
}) => (
  <View style={{ flex: 1, ...gradientBackground(linearGradient("160deg", ...colors)) }}>
    <View
      style={{
        flex: 1,
        paddingHorizontal: 28,
        paddingVertical: 96,
        justifyContent: "center",
        gap: 18,
      }}
    >
      {children}
    </View>
  </View>
);

const Kicker = ({ text }: { text: string }) => (
  <Text
    style={{
      color: "rgba(255,255,255,0.85)",
      fontSize: 13,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 1.2,
    }}
  >
    {text}
  </Text>
);

const Big = ({ text }: { text: string }) => (
  <Text style={{ color: "#fff", fontSize: 40, fontWeight: "900", letterSpacing: -0.8 }}>
    {text}
  </Text>
);

export default function RewindScreen() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useTheme();
  const year = new Date().getFullYear();

  const artistsQuery = useTopArtists("all", 5);
  const songsQuery = useTopSongsOverall("all", 5);
  const monthArtistsQuery = useTopArtists("30d", 1);

  const artists = useMemo(() => artistsQuery.data ?? [], [artistsQuery.data]);
  const songs = useMemo(() => songsQuery.data ?? [], [songsQuery.data]);
  const monthArtist = monthArtistsQuery.data?.[0] ?? null;
  const loading = artistsQuery.isLoading || songsQuery.isLoading;

  const cards = useMemo<StoryCard[]>(() => {
    const g = MIX_KIND_GRADIENTS;
    const out: StoryCard[] = [
      {
        key: "intro",
        render: () => (
          <CardShell colors={g.year_mix.colors}>
            <Kicker text={t(`${R}.introKicker`)} />
            <Text
              style={{ color: "#fff", fontSize: 64, fontWeight: "900", letterSpacing: -1.5 }}
            >
              {`Rewind ${year}`}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 16, lineHeight: 22 }}>
              {t(`${R}.introBody`)}
            </Text>
          </CardShell>
        ),
      },
    ];

    const top = artists[0];
    if (top) {
      const name = artistDisplayName(top.artist) ?? "?";
      const uri =
        typeof top.artist === "object"
          ? artworkSourceUri(artistImageSource(top.artist, "lg"))
          : null;
      out.push({
        key: "top-artist",
        render: () => (
          <CardShell colors={g.top_artist.colors}>
            <Kicker text={t(`${R}.topArtistKicker`)} />
            {uri ? (
              <Image
                source={{ uri }}
                style={{ width: 180, height: 180, borderRadius: 90 }}
                contentFit="cover"
              />
            ) : null}
            <Big text={name} />
            <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 16 }}>
              {t(`${R}.playCount`, { count: top.play_count })}
            </Text>
          </CardShell>
        ),
      });
      out.push({
        key: "artists",
        render: () => (
          <CardShell colors={g.this_is.colors}>
            <Kicker text={t(`${R}.artistsKicker`)} />
            <View style={{ gap: 14 }}>
              {artists.map((row, i) => (
                <View
                  key={`ra-${i}`}
                  style={{ flexDirection: "row", alignItems: "center", gap: 14 }}
                >
                  <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 22, fontWeight: "900", width: 30 }}>
                    {i + 1}
                  </Text>
                  <Text
                    style={{ color: "#fff", fontSize: 22, fontWeight: "700", flexShrink: 1 }}
                    numberOfLines={1}
                  >
                    {artistDisplayName(row.artist) ?? "?"}
                  </Text>
                  <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, marginLeft: "auto" }}>
                    {row.play_count}
                  </Text>
                </View>
              ))}
            </View>
          </CardShell>
        ),
      });
    }

    const topSong = songs[0];
    if (topSong) {
      out.push({
        key: "top-song",
        render: () => (
          <CardShell colors={g.monthly_rewind.colors}>
            <Kicker text={t(`${R}.topSongKicker`)} />
            <ArtworkImage
              source={songArtworkSource(topSong.song)}
              songId={topSong.song.id}
              size={200}
            />
            <Big text={topSong.song.title} />
            <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 16 }}>
              {formatArtists(topSong.song)}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 15 }}>
              {t(`${R}.playCount`, { count: topSong.play_count })}
            </Text>
          </CardShell>
        ),
      });
      out.push({
        key: "songs",
        render: () => (
          <CardShell colors={g.repeat_rewind.colors}>
            <Kicker text={t(`${R}.songsKicker`)} />
            <View style={{ gap: 14 }}>
              {songs.map((row, i) => (
                <View
                  key={`rs-${i}`}
                  style={{ flexDirection: "row", alignItems: "center", gap: 14 }}
                >
                  <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 22, fontWeight: "900", width: 30 }}>
                    {i + 1}
                  </Text>
                  <View style={{ flexShrink: 1, minWidth: 0 }}>
                    <Text
                      style={{ color: "#fff", fontSize: 19, fontWeight: "700" }}
                      numberOfLines={1}
                    >
                      {row.song.title}
                    </Text>
                    <Text
                      style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}
                      numberOfLines={1}
                    >
                      {formatArtists(row.song)}
                    </Text>
                  </View>
                  <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, marginLeft: "auto" }}>
                    {row.play_count}
                  </Text>
                </View>
              ))}
            </View>
          </CardShell>
        ),
      });
    }

    if (monthArtist) {
      out.push({
        key: "month",
        render: () => (
          <CardShell colors={g.discoveries.colors}>
            <Kicker text={t(`${R}.monthKicker`)} />
            <Big text={artistDisplayName(monthArtist.artist) ?? "?"} />
            <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 16 }}>
              {t(`${R}.monthBody`)}
            </Text>
          </CardShell>
        ),
      });
    }

    out.push({
      key: "outro",
      render: () => (
        <CardShell colors={g.year_mix.colors}>
          <Kicker text={t(`${R}.outroKicker`)} />
          <Text style={{ color: "#fff", fontSize: 30, fontWeight: "900", letterSpacing: -0.6 }}>
            {t(`${R}.outroBody`)}
          </Text>
          <Text
            style={{
              color: "rgba(255,255,255,0.9)",
              fontFamily: FONT_DRUK_WIDE,
              fontSize: 15,
              letterSpacing: 0.5,
              marginTop: 8,
            }}
          >
            OMS Music
          </Text>
        </CardShell>
      ),
    });
    return out;
  }, [artists, songs, monthArtist, t, year]);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#000",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={tokens.primary} />
      </View>
    );
  }

  // Sem plays não há retrospectiva: um cartão honesto em vez de zeros.
  if (artists.length === 0 && songs.length === 0) {
    return (
      <StoryPager
        cards={[
          {
            key: "empty",
            render: () => (
              <CardShell colors={MIX_KIND_GRADIENTS.discoveries.colors}>
                <Kicker text={`Rewind ${year}`} />
                <Big text={t(`${R}.emptyTitle`)} />
                <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 16 }}>
                  {t(`${R}.emptyBody`)}
                </Text>
              </CardShell>
            ),
          },
        ]}
        onClose={() => router.back()}
      />
    );
  }

  return <StoryPager cards={cards} onClose={() => router.back()} />;
}
