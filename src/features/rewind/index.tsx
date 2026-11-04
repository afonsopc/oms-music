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
 *
 * Redesenho 2026-11-04 (docs/redesenho.md): sem gradientes de cor. Cada
 * cartão tem por fundo a capa (ou a foto do artista) de que fala, em ecrã
 * inteiro e desfocada, com um véu escuro por cima e letra branca grande;
 * a cor vem só das capas. Enquanto os números não chegam aparece logo um
 * cartão-esqueleto com as barras, nunca um spinner num ecrã preto.
 */
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Text, useWindowDimensions, View } from "react-native";
import { Reveal as MotionReveal, useCountUp } from "@/ui/motion";
import { useRouter } from "expo-router";
import { useTopArtists, useTopSongs, useTopSongsOverall } from "@/api/queries/playEvents";
import { getTransport } from "@/contracts/transport";
import { remoteStore } from "@/remote/store";
import { mayPlaySoundtrack } from "./soundtrackPolicy";
import { artistDisplayName } from "@/domain/album";
import type { SongId } from "@/domain/ids";
import { artistImageSource, songArtworkSource } from "@/domain/artwork";
import { formatArtists } from "@/domain/format";
import type { Song } from "@/domain/song";
import { previewSeekSeconds } from "@/features/artist/previewMath";
import { useT } from "@/i18n";
import { playerStore } from "@/player/store";
import { FONT_OMS_WIDE } from "@/theme/typography";
import {
  ArtworkImage,
  artworkSourceUri,
  Skeleton,
  StoryPager,
  useContainerWidth,
  type StoryCard,
} from "@/ui";
import { TextButton, WaitHint } from "@/ui/page";
import { gradientBackground, linearGradient } from "@/ui/uiTheme";
import { Image } from "expo-image";
import { loyaltyPercent, totalListenMinutes } from "./rewindMath";

const R = "components.music.Rewind";

/** O fundo de todos os cartões (e do esqueleto): quase preto. */
const INK = "#0a0a0a";
const WHITE = "#ffffff";
const SOFT = "rgba(255,255,255,0.72)";
const FAINT = "rgba(255,255,255,0.5)";

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

/** Entrada escalonada (ui/motion), um pouco mais lenta do que nas listas. */
const Reveal = ({ order = 0, children }: { order?: number; children: React.ReactNode }) => (
  <MotionReveal order={order} step={90} distance={16} duration={420}>
    {children}
  </MotionReveal>
);

/**
 * Conta de 0 até `value` (ui/motion useCountUp). Render-prop para o
 * chamador embrulhar o número na string i18n (plurais ICU).
 */
const CountUp = ({
  value,
  children,
}: {
  value: number;
  children: (n: number) => React.ReactNode;
}) => {
  const shown = useCountUp(value, 1300);
  return <>{children(shown)}</>;
};

/** O lado da capa grande de um cartão: cabe na largura e em 42 % da altura. */
const useArtSize = (): number => {
  const width = useContainerWidth();
  const { height } = useWindowDimensions();
  return Math.round(Math.max(140, Math.min(width - 56, 360, height * 0.42)));
};

/**
 * Fundo de cartão: a capa de que o cartão fala, em ecrã inteiro e muito
 * desfocada, com um véu preto que escurece para baixo (onde vive o texto).
 * Sem capa, fica o preto. O texto assenta em baixo, à esquerda, como numa
 * página de revista.
 */
const CardShell = ({ artUri, children }: { artUri?: string | null; children: React.ReactNode }) => (
  <View style={{ flex: 1, backgroundColor: INK, overflow: "hidden" }}>
    {artUri ? (
      <>
        <Image
          alt=""
          source={{ uri: artUri }}
          contentFit="cover"
          blurRadius={50}
          transition={300}
          style={{
            position: "absolute",
            top: -40,
            left: -40,
            right: -40,
            bottom: -40,
            transform: [{ scale: 1.15 }],
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
                "rgba(0,0,0,0.45) 0%",
                "rgba(0,0,0,0.55) 45%",
                "rgba(0,0,0,0.88) 100%",
              ),
            ),
          }}
        />
      </>
    ) : null}
    <View
      style={{
        flex: 1,
        width: "100%",
        maxWidth: 640,
        alignSelf: "center",
        paddingHorizontal: 28,
        paddingTop: 88,
        paddingBottom: 64,
        justifyContent: "flex-end",
        gap: 16,
      }}
    >
      {children}
    </View>
  </View>
);

const Kicker = ({ text }: { text: string }) => (
  <Text
    style={{
      color: SOFT,
      fontSize: 13,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 1.4,
    }}
  >
    {text}
  </Text>
);

const Big = ({ text }: { text: string }) => (
  <Text
    numberOfLines={3}
    style={{ color: WHITE, fontSize: 44, lineHeight: 46, fontWeight: "800", letterSpacing: -1.2 }}
  >
    {text}
  </Text>
);

const Line = ({ text, dim = false }: { text: string; dim?: boolean }) => (
  <Text style={{ color: dim ? FAINT : SOFT, fontSize: 17, lineHeight: 23 }}>{text}</Text>
);

/** Uma linha das listas de top 5: número, nome (e artista), contagem. */
const RankRow = ({
  rank,
  title,
  meta,
  count,
}: {
  rank: number;
  title: string;
  meta?: string;
  count: number;
}) => (
  <View
    style={{
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: "rgba(255,255,255,0.12)",
    }}
  >
    <Text style={{ color: FAINT, fontSize: 24, fontWeight: "800", width: 26 }}>{rank}</Text>
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={{ color: WHITE, fontSize: 20, fontWeight: "700" }} numberOfLines={1}>
        {title}
      </Text>
      {meta ? (
        <Text style={{ color: FAINT, fontSize: 14 }} numberOfLines={1}>
          {meta}
        </Text>
      ) : null}
    </View>
    <Text style={{ color: FAINT, fontSize: 14 }}>{count}</Text>
  </View>
);

/**
 * O cartão que aparece no primeiro frame, antes de os números chegarem: as
 * barras, o fecho e o sítio do texto a brilhar. Uma espera longa ganha a
 * frase que muda e, aos 20 s, "Tentar de novo".
 */
const SkeletonStory = ({
  onClose,
  onRetry,
  failed,
}: {
  onClose: () => void;
  onRetry: () => void;
  failed: boolean;
}) => {
  const t = useT();
  const block = { backgroundColor: "rgba(255,255,255,0.14)" };
  return (
    <StoryPager
      cards={[
        {
          key: "loading",
          // Muito longo: o esqueleto não avança sozinho para lado nenhum.
          durationMs: 3_600_000,
          render: () => (
            <CardShell>
              {failed ? (
                <View style={{ gap: 16, alignItems: "flex-start" }}>
                  <Big text={t("native.common.loadFailed")} />
                  <TextButton label={t("native.common.tryAgain")} onPress={onRetry} />
                </View>
              ) : (
                <>
                  <Skeleton width={150} height={12} style={block} />
                  <Skeleton width="80%" height={40} style={block} />
                  <Skeleton width="55%" height={40} style={block} />
                  <Skeleton width="68%" height={14} style={block} />
                  <WaitHint active onRetry={onRetry} style={{ alignItems: "flex-start" }} />
                </>
              )}
            </CardShell>
          ),
        },
      ]}
      onClose={onClose}
    />
  );
};

export default function RewindScreen() {
  const t = useT();
  const router = useRouter();
  const artSize = useArtSize();
  const year = new Date().getFullYear();

  const artistsQuery = useTopArtists("all", 5);
  const songsQuery = useTopSongsOverall("all", 5);
  const monthArtistsQuery = useTopArtists("30d", 1);

  const artists = useMemo(() => artistsQuery.data ?? [], [artistsQuery.data]);
  const songs = useMemo(() => songsQuery.data ?? [], [songsQuery.data]);
  const monthArtist = monthArtistsQuery.data?.[0] ?? null;
  // isPending, não isLoading: enquanto a sessão não está pronta as queries
  // ficam paradas (isLoading false) e o Rewind mostrava "Ainda sem
  // história" a quem tem centenas de reproduções.
  const loading = artistsQuery.isPending || songsQuery.isPending;
  const failed = artistsQuery.isError && songsQuery.isError;

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
    const cards: StoryCard[] = [];
    // Banda sonora por cartão; null = "sem música própria, continua a
    // anterior". Índices alinhados com `cards`.
    const soundtrack: (Song | null)[] = [];
    // Os fundos de todos os cartões, para os pedir de uma vez à cabeça.
    const backdrops: string[] = [];
    const push = (card: StoryCard, song: Song | null = null, backdrop: string | null = null): void => {
      cards.push(card);
      soundtrack.push(song);
      if (backdrop) backdrops.push(backdrop);
    };

    const songArt = (song: Song | null | undefined): string | null =>
      song ? artworkSourceUri(songArtworkSource(song)) : null;
    const artistArt = (artist: (typeof artists)[number]["artist"] | undefined): string | null =>
      artist && typeof artist === "object" ? artworkSourceUri(artistImageSource(artist, "lg")) : null;

    const anthem = songs[0]?.song ?? null;
    const anthemArt = songArt(anthem);

    push(
      {
        key: "intro",
        render: () => (
          <CardShell key="intro" artUri={anthemArt}>
            <Reveal order={0}>
              <Kicker text={t(`${R}.introKicker`)} />
            </Reveal>
            <Reveal order={1}>
              <Text
                style={{
                  color: WHITE,
                  fontSize: 72,
                  lineHeight: 70,
                  fontWeight: "900",
                  letterSpacing: -2.4,
                }}
              >
                {`Rewind\n${year}`}
              </Text>
            </Reveal>
            <Reveal order={2}>
              <Line text={t(`${R}.introBody`)} />
            </Reveal>
          </CardShell>
        ),
      },
      // O hino do ano abre a retrospectiva: a música mais ouvida de sempre.
      anthem,
      anthemArt,
    );

    const top = artists[0];
    if (top) {
      const name = artistDisplayName(top.artist) ?? "?";
      const uri = artistArt(top.artist);
      push(
        {
          key: "top-artist",
          render: () => (
            <CardShell key="top-artist" artUri={uri}>
              {uri ? (
                <Reveal order={0}>
                  <Image
                    alt=""
                    source={{ uri }}
                    style={{ width: artSize, height: artSize, borderRadius: artSize / 2 }}
                    contentFit="cover"
                    transition={200}
                  />
                </Reveal>
              ) : null}
              <Reveal order={1}>
                <Kicker text={t(`${R}.topArtistKicker`)} />
              </Reveal>
              <Reveal order={2}>
                <Big text={name} />
              </Reveal>
              <Reveal order={3}>
                <CountUp value={top.play_count}>
                  {(n) => <Line text={t(`${R}.playCount`, { count: n })} />}
                </CountUp>
              </Reveal>
            </CardShell>
          ),
        },
        topArtistSong,
        uri,
      );
      push({
        key: "artists",
        render: () => (
          <CardShell key="artists" artUri={uri}>
            <Reveal order={0}>
              <Kicker text={t(`${R}.artistsKicker`)} />
            </Reveal>
            <View>
              {artists.map((row, i) => (
                <Reveal key={`ra-${i}`} order={i + 1}>
                  <RankRow
                    rank={i + 1}
                    title={artistDisplayName(row.artist) ?? "?"}
                    count={row.play_count}
                  />
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
            <CardShell key="top-song" artUri={anthemArt}>
              <Reveal order={0}>
                <ArtworkImage
                  source={songArtworkSource(topSong.song)}
                  songId={topSong.song.id}
                  size={artSize}
                />
              </Reveal>
              <Reveal order={1}>
                <Kicker text={t(`${R}.topSongKicker`)} />
              </Reveal>
              <Reveal order={2}>
                <Big text={topSong.song.title} />
              </Reveal>
              <Reveal order={3}>
                <Line text={formatArtists(topSong.song)} />
              </Reveal>
              <Reveal order={4}>
                <CountUp value={topSong.play_count}>
                  {(n) => <Line dim text={t(`${R}.playCount`, { count: n })} />}
                </CountUp>
              </Reveal>
            </CardShell>
          ),
        },
        topSong.song,
      );
      const listArt = songArt(songs[1]?.song) ?? anthemArt;
      push(
        {
          key: "songs",
          render: () => (
            <CardShell key="songs" artUri={listArt}>
              <Reveal order={0}>
                <Kicker text={t(`${R}.songsKicker`)} />
              </Reveal>
              <View>
                {songs.map((row, i) => (
                  <Reveal key={`rs-${i}`} order={i + 1}>
                    <RankRow
                      rank={i + 1}
                      title={row.song.title}
                      meta={formatArtists(row.song)}
                      count={row.play_count}
                    />
                  </Reveal>
                ))}
              </View>
            </CardShell>
          ),
        },
        null,
        listArt,
      );

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
            <CardShell key="time" artUri={anthemArt}>
              <Reveal order={0}>
                <Kicker text={t(`${R}.timeKicker`)} />
              </Reveal>
              <Reveal order={1}>
                <CountUp value={minutes}>
                  {(n) => (
                    <Text
                      style={{
                        color: WHITE,
                        fontSize: 96,
                        lineHeight: 96,
                        fontWeight: "900",
                        letterSpacing: -3,
                      }}
                    >
                      {n}
                    </Text>
                  )}
                </CountUp>
              </Reveal>
              <Reveal order={2}>
                <Line text={t(`${R}.timeUnit`)} />
              </Reveal>
              <Reveal order={3}>
                <Line dim text={t(`${R}.loyaltyLine`, { percent: loyalty })} />
              </Reveal>
            </CardShell>
          ),
        });
      }
    }

    if (monthArtist) {
      const uri = artistArt(monthArtist.artist);
      push(
        {
          key: "month",
          render: () => (
            <CardShell key="month" artUri={uri}>
              <Reveal order={0}>
                <Kicker text={t(`${R}.monthKicker`)} />
              </Reveal>
              <Reveal order={1}>
                <Big text={artistDisplayName(monthArtist.artist) ?? "?"} />
              </Reveal>
              <Reveal order={2}>
                <Line text={t(`${R}.monthBody`)} />
              </Reveal>
            </CardShell>
          ),
        },
        monthArtistSong,
        uri,
      );
    }

    push({
      key: "outro",
      render: () => (
        <CardShell key="outro" artUri={anthemArt}>
          <Reveal order={0}>
            <Kicker text={t(`${R}.outroKicker`)} />
          </Reveal>
          <Reveal order={1}>
            <Big text={t(`${R}.outroBody`)} />
          </Reveal>
          <Reveal order={2}>
            <Text
              style={{
                color: SOFT,
                fontFamily: FONT_OMS_WIDE,
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
    return { cards, soundtrack, backdrops };
  }, [artists, songs, monthArtist, topArtistSong, monthArtistSong, t, year, artSize]);

  // Os fundos todos de uma vez, assim que se sabem: o cartão seguinte já
  // tem a capa quando aparece, em vez de entrar preto e acender depois.
  useEffect(() => {
    if (built.backdrops.length > 0) void Image.prefetch(built.backdrops).catch(() => false);
  }, [built.backdrops]);

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
    // A comandar outro aparelho, as histórias ficam caladas (não roubam o som).
    if (!mayPlaySoundtrack(remoteStore.getState().role)) return;
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

  const close = useCallback(() => router.back(), [router]);
  const retry = useCallback(() => {
    void artistsQuery.refetch();
    void songsQuery.refetch();
  }, [artistsQuery, songsQuery]);

  if (loading || failed) {
    return <SkeletonStory onClose={close} onRetry={retry} failed={failed && !loading} />;
  }

  // Sem plays não há retrospectiva: um cartão honesto em vez de zeros.
  if (artists.length === 0 && songs.length === 0) {
    return (
      <StoryPager
        cards={[
          {
            key: "empty",
            render: () => (
              <CardShell>
                <Kicker text={`Rewind ${year}`} />
                <Big text={t(`${R}.emptyTitle`)} />
                <Line text={t(`${R}.emptyBody`)} />
              </CardShell>
            ),
          },
        ]}
        onClose={close}
      />
    );
  }

  return <StoryPager cards={built.cards} onClose={close} onIndexChange={playCardSong} />;
}
