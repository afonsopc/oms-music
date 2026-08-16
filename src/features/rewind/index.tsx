/**
 * O Rewind (pedido do dono, 2026-08-18): a retrospectiva em formato stories
 * - o StoryPager genérico com cartões de conteúdo por cima dos gradientes
 * dos mixes. v1 assumida: os números vêm dos agregados que a API já serve
 * (top de sempre e 30 dias) - o dono decidiu por mensagem que ter o formato
 * NO AR vale mais do que esperar pela auditoria das contagens (2.4); quando
 * o backend ganhar agregados por ano, só o data-hook muda.
 *
 * 2026-08-16, queixa do dono ("não toca música nenhuma e até é boring"):
 * - ÁUDIO REAL: cada cartão que destaca uma música ou artista toca essa
 *   música pelo próprio motor (para artista, a mais ouvida dele), saltando
 *   para ~1/3 da faixa como o preview de artista já faz. Cartões sem música
 *   própria deixam a anterior continuar. Ao contrário do preview, aqui
 *   GUARDA-SE o que tocava antes (fila + posição + pausado) e repõe-se ao
 *   sair - tudo pelo seam do transport + o espelho zustand, sem segundo
 *   motor de áudio.
 * - VIDA: números que contam de 0 até ao valor, entradas escalonadas dos
 *   elementos (opacidade/translate à mão - a web não suporta entering/
 *   exiting do Reanimated), a artwork desfocada por baixo do gradiente como
 *   o player imersivo faz, e um cartão novo ("o tempo que deste") calculado
 *   só com o que o endpoint já devolve: contagens x durações.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import { useTopArtists, useTopSongs, useTopSongsOverall } from "@/api/queries/playEvents";
import { getTransport } from "@/contracts/transport";
import { artistDisplayName } from "@/domain/album";
import type { SongId } from "@/domain/ids";
import { artistImageSource, songArtworkSource } from "@/domain/artwork";
import { formatArtists } from "@/domain/format";
import type { Song } from "@/domain/song";
import { previewSeekSeconds } from "@/features/artist/previewMath";
import { useT } from "@/i18n";
import { playerStore } from "@/player/store";
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
import { loyaltyPercent, totalListenMinutes } from "./rewindMath";

const R = "components.music.Rewind";

/**
 * O que tocava antes do Rewind tomar conta do motor. `startIndex` é o índice
 * de BACKING da música audível (queueOrder[queueIndex]), que é o que o
 * setQueue do transport aceita para repor a mesma música como actual.
 */
interface PlayerSnapshot {
  queue: Song[];
  startIndex: number;
  shuffle: boolean;
  position: number;
  playing: boolean;
}

/**
 * Entrada escalonada à mão (opacidade + translate): a web não corre os
 * entering/exiting do Reanimated, mas useSharedValue + withTiming correm em
 * todo o lado - é o padrão do cinema e das letras.
 */
const Reveal = ({ order = 0, children }: { order?: number; children: React.ReactNode }) => {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(order * 90, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, [p, order]);
  const style = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: 16 * (1 - p.value) }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
};

/**
 * Conta de 0 até `value` com withTiming; o número atravessa o runOnJS para
 * estado React porque o texto final (plurais ICU) é formatado em JS, não no
 * worklet. Render-prop para o chamador embrulhar o número na string i18n.
 */
const CountUp = ({
  value,
  children,
}: {
  value: number;
  children: (n: number) => React.ReactNode;
}) => {
  const [shown, setShown] = useState(0);
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(1, { duration: 1300, easing: Easing.out(Easing.cubic) });
  }, [p]);
  useAnimatedReaction(
    () => p.value,
    (v) => {
      runOnJS(setShown)(Math.round(v * value));
    },
    [value],
  );
  return <>{children(shown)}</>;
};

/**
 * Fundo de cartão: o gradiente diagonal dos mixes e, quando o cartão tem
 * artwork, a própria imagem desfocada por baixo de um véu escuro - o idioma
 * do player imersivo (immersive.tsx), que dá cor ESPECÍFICA da música sem
 * extracção de accent nem surpresas de contraste.
 */
const CardShell = ({
  colors,
  artUri,
  children,
}: {
  colors: readonly [string, string, string];
  artUri?: string | null;
  children: React.ReactNode;
}) => (
  <View style={{ flex: 1, ...gradientBackground(linearGradient("160deg", ...colors)) }}>
    {artUri ? (
      <>
        <Image
          source={{ uri: artUri }}
          contentFit="cover"
          blurRadius={40}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            opacity: 0.5,
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            ...gradientBackground(
              linearGradient(
                "to bottom",
                "rgba(0,0,0,0.12) 0%",
                "rgba(0,0,0,0.4) 55%",
                "rgba(0,0,0,0.72) 100%",
              ),
            ),
          }}
        />
      </>
    ) : null}
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

  // A música mais ouvida DE CADA artista destacado, pelos hooks que a vista
  // de artista já usa. Se ainda não chegou quando o cartão aparece, o cartão
  // simplesmente deixa continuar a música anterior.
  const topArtistName = artists[0] ? artistDisplayName(artists[0].artist) : null;
  const monthArtistName = monthArtist ? artistDisplayName(monthArtist.artist) : null;
  const topArtistSongQuery = useTopSongs(topArtistName, { since: "all", limit: 1 });
  const monthArtistSongQuery = useTopSongs(monthArtistName, { since: "30d", limit: 1 });
  const topArtistSong = topArtistSongQuery.data?.[0]?.song ?? null;
  const monthArtistSong = monthArtistSongQuery.data?.[0]?.song ?? null;

  const built = useMemo(() => {
    const g = MIX_KIND_GRADIENTS;
    const cards: StoryCard[] = [];
    // Banda sonora por cartão; null = "sem música própria, continua a
    // anterior". Índices alinhados com `cards`.
    const soundtrack: (Song | null)[] = [];
    const push = (card: StoryCard, song: Song | null = null): void => {
      cards.push(card);
      soundtrack.push(song);
    };

    const anthem = songs[0]?.song ?? null;

    push(
      {
        key: "intro",
        render: () => (
          <CardShell key="intro" colors={g.year_mix.colors}>
            <Reveal order={0}>
              <Kicker text={t(`${R}.introKicker`)} />
            </Reveal>
            <Reveal order={1}>
              <Text
                style={{ color: "#fff", fontSize: 64, fontWeight: "900", letterSpacing: -1.5 }}
              >
                {`Rewind ${year}`}
              </Text>
            </Reveal>
            <Reveal order={2}>
              <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 16, lineHeight: 22 }}>
                {t(`${R}.introBody`)}
              </Text>
            </Reveal>
          </CardShell>
        ),
      },
      // O hino do ano abre a retrospectiva: a música mais ouvida de sempre.
      anthem,
    );

    const top = artists[0];
    if (top) {
      const name = artistDisplayName(top.artist) ?? "?";
      const uri =
        typeof top.artist === "object"
          ? artworkSourceUri(artistImageSource(top.artist, "lg"))
          : null;
      push(
        {
          key: "top-artist",
          render: () => (
            <CardShell key="top-artist" colors={g.top_artist.colors} artUri={uri}>
              <Reveal order={0}>
                <Kicker text={t(`${R}.topArtistKicker`)} />
              </Reveal>
              {uri ? (
                <Reveal order={1}>
                  <Image
                    source={{ uri }}
                    style={{ width: 180, height: 180, borderRadius: 90 }}
                    contentFit="cover"
                  />
                </Reveal>
              ) : null}
              <Reveal order={2}>
                <Big text={name} />
              </Reveal>
              <Reveal order={3}>
                <CountUp value={top.play_count}>
                  {(n) => (
                    <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 16 }}>
                      {t(`${R}.playCount`, { count: n })}
                    </Text>
                  )}
                </CountUp>
              </Reveal>
            </CardShell>
          ),
        },
        topArtistSong,
      );
      push({
        key: "artists",
        render: () => (
          <CardShell key="artists" colors={g.this_is.colors}>
            <Reveal order={0}>
              <Kicker text={t(`${R}.artistsKicker`)} />
            </Reveal>
            <View style={{ gap: 14 }}>
              {artists.map((row, i) => (
                <Reveal key={`ra-${i}`} order={i + 1}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
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
                </Reveal>
              ))}
            </View>
          </CardShell>
        ),
      });
    }

    const topSong = songs[0];
    if (topSong) {
      push(
        {
          key: "top-song",
          render: () => (
            <CardShell
              key="top-song"
              colors={g.monthly_rewind.colors}
              artUri={artworkSourceUri(songArtworkSource(topSong.song))}
            >
              <Reveal order={0}>
                <Kicker text={t(`${R}.topSongKicker`)} />
              </Reveal>
              <Reveal order={1}>
                <ArtworkImage
                  source={songArtworkSource(topSong.song)}
                  songId={topSong.song.id}
                  size={200}
                />
              </Reveal>
              <Reveal order={2}>
                <Big text={topSong.song.title} />
              </Reveal>
              <Reveal order={3}>
                <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 16 }}>
                  {formatArtists(topSong.song)}
                </Text>
              </Reveal>
              <Reveal order={4}>
                <CountUp value={topSong.play_count}>
                  {(n) => (
                    <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 15 }}>
                      {t(`${R}.playCount`, { count: n })}
                    </Text>
                  )}
                </CountUp>
              </Reveal>
            </CardShell>
          ),
        },
        topSong.song,
      );
      push({
        key: "songs",
        render: () => (
          <CardShell key="songs" colors={g.repeat_rewind.colors}>
            <Reveal order={0}>
              <Kicker text={t(`${R}.songsKicker`)} />
            </Reveal>
            <View style={{ gap: 14 }}>
              {songs.map((row, i) => (
                <Reveal key={`rs-${i}`} order={i + 1}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
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
                </Reveal>
              ))}
            </View>
          </CardShell>
        ),
      });

      // Cartão novo, só com o que o endpoint já dá: contagens x durações das
      // top 5, mais a fatia da número um. Sem durações não há número para
      // mostrar - o cartão fica de fora em vez de exibir um zero.
      const minutes = totalListenMinutes(
        songs.map((row) => ({ play_count: row.play_count, duration: row.song.duration })),
      );
      const loyalty = loyaltyPercent(songs.map((row) => row.play_count));
      if (minutes > 0) {
        push({
          key: "time",
          render: () => (
            <CardShell key="time" colors={g.time_capsule.colors}>
              <Reveal order={0}>
                <Kicker text={t(`${R}.timeKicker`)} />
              </Reveal>
              <Reveal order={1}>
                <CountUp value={minutes}>
                  {(n) => (
                    <Text
                      style={{ color: "#fff", fontSize: 72, fontWeight: "900", letterSpacing: -1.5 }}
                    >
                      {n}
                    </Text>
                  )}
                </CountUp>
              </Reveal>
              <Reveal order={2}>
                <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 16, lineHeight: 22 }}>
                  {t(`${R}.timeUnit`)}
                </Text>
              </Reveal>
              <Reveal order={3}>
                <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 15, lineHeight: 21 }}>
                  {t(`${R}.loyaltyLine`, { percent: loyalty })}
                </Text>
              </Reveal>
            </CardShell>
          ),
        });
      }
    }

    if (monthArtist) {
      const uri =
        typeof monthArtist.artist === "object"
          ? artworkSourceUri(artistImageSource(monthArtist.artist, "lg"))
          : null;
      push(
        {
          key: "month",
          render: () => (
            <CardShell key="month" colors={g.discoveries.colors} artUri={uri}>
              <Reveal order={0}>
                <Kicker text={t(`${R}.monthKicker`)} />
              </Reveal>
              <Reveal order={1}>
                <Big text={artistDisplayName(monthArtist.artist) ?? "?"} />
              </Reveal>
              <Reveal order={2}>
                <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 16 }}>
                  {t(`${R}.monthBody`)}
                </Text>
              </Reveal>
            </CardShell>
          ),
        },
        monthArtistSong,
      );
    }

    push({
      key: "outro",
      render: () => (
        <CardShell key="outro" colors={g.year_mix.colors}>
          <Reveal order={0}>
            <Kicker text={t(`${R}.outroKicker`)} />
          </Reveal>
          <Reveal order={1}>
            <Text style={{ color: "#fff", fontSize: 30, fontWeight: "900", letterSpacing: -0.6 }}>
              {t(`${R}.outroBody`)}
            </Text>
          </Reveal>
          <Reveal order={2}>
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
          </Reveal>
        </CardShell>
      ),
    });
    return { cards, soundtrack };
  }, [artists, songs, monthArtist, topArtistSong, monthArtistSong, t, year]);

  // ----- banda sonora -------------------------------------------------------
  // Refs em vez de deps: o relógio do StoryPager quer um onIndexChange
  // estável, e o restauro no unmount não pode depender de closures velhas.
  const soundtrackRef = useRef<(Song | null)[]>([]);
  useEffect(() => {
    soundtrackRef.current = built.soundtrack;
  }, [built.soundtrack]);

  const startedRef = useRef(false);
  const snapshotRef = useRef<PlayerSnapshot | null>(null);
  const nowPlayingRef = useRef<SongId | null>(null);
  const lastIndexRef = useRef(0);

  const playCardSong = useCallback((index: number): void => {
    lastIndexRef.current = index;
    const song = soundtrackRef.current[index];
    // null = cartão sem música própria: a anterior continua. A mesma música
    // em cartões seguidos também não recomeça (setQueue reasserta áudio).
    if (!song || song.id === nowPlayingRef.current) return;
    if (!startedRef.current) {
      // Fotografa o player ANTES do primeiro takeover: a fila, a música
      // audível, a posição e o pausado saem do espelho zustand (leitura de
      // UI sancionada) - o restauro refaz tudo pelo transport.
      startedRef.current = true;
      const s = playerStore.getState();
      snapshotRef.current = {
        queue: s.queue,
        startIndex: s.queueOrder[s.queueIndex] ?? 0,
        shuffle: s.shuffle,
        position: s.position,
        playing: s.playing,
      };
    }
    nowPlayingRef.current = song.id;
    getTransport().setQueue([song], 0);
    // O salto do preview de artista: ~1/3 da faixa, onde os refrões vivem,
    // nunca o silêncio do intro.
    const target = previewSeekSeconds(song.duration);
    if (target > 0) getTransport().seek(target);
  }, []);

  // Arranque: quando os dados chegam, o cartão 0 ganha banda sonora. E se a
  // música do artista destacado chegar DEPOIS de o cartão já estar no ecrã,
  // re-tenta no cartão actual em vez de o deixar mudo.
  useEffect(() => {
    if (!loading && !startedRef.current) playCardSong(0);
  }, [loading, playCardSong]);
  useEffect(() => {
    if (startedRef.current) playCardSong(lastIndexRef.current);
  }, [topArtistSong, monthArtistSong, playCardSong]);

  // Restauro ao sair (router.back desmonta o ecrã): repõe a fila antiga com
  // a mesma música audível, volta à posição e respeita o pausado. Se o
  // Rewind nunca chegou a tocar nada, não há nada a repor. Fila antiga
  // vazia: pausa e pronto, como o preview de artista.
  useEffect(
    () => () => {
      if (!startedRef.current) return;
      const snap = snapshotRef.current;
      const transport = getTransport();
      if (!snap || snap.queue.length === 0) {
        transport.pause();
        return;
      }
      transport.setQueue(snap.queue, snap.startIndex, { shuffle: snap.shuffle });
      // seek é seguro logo a seguir a setQueue (pendingSeek no engine).
      transport.seek(snap.position);
      if (!snap.playing) transport.pause();
    },
    [],
  );

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

  return (
    <StoryPager cards={built.cards} onClose={() => router.back()} onIndexChange={playCardSong} />
  );
}
