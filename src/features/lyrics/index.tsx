/**
 * Lyrics page of the (player) pager (FR-75..81), a faithful port of the web
 * LyricsView (frontend/components/music/LyricsView.tsx):
 *
 *  - fetch with skeleton-on-slow-first, 200-with-nulls empty state, ~24 h
 *    client cache (WP1 hook), attribution footer, plain-only fallback;
 *  - synced rendering driven by the playback projection (remote/mirror: the
 *    player store's 4 Hz leaf slice locally, the mirrored snapshot while this
 *    device controls another one - the mandated UI read path, never the
 *    AudioPlayer): the active index is recomputed per tick but STATE only
 *    updates when the index changes, so there is no re-render churn; the
 *    tracking subscription stops entirely while the route is not focused
 *    (FR-77 battery rule);
 *  - auto-center scroll with a 4 s manual-scroll grace and a "back to
 *    current line" pill; tap-to-seek through the transport contract,
 *    including placeholder-dot lines (FR-78);
 *  - translation to 7 targets, persisted per device, aligned by
 *    time.toFixed(2) / line index with identical-line suppression, 429
 *    shown inline, never auto-retried (FR-79);
 *  - on-demand sync generation over POST /lyrics/sync + JobChannel with the
 *    10 s REST poll fallback (FR-80).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useIsFocused } from "expo-router";
import { useTween } from "@/ui/motion";
import {
  nudgeLyricsOffset,
  refineLyrics,
  retranslateLyrics,
  useLyrics,
  useLyricsTranslation,
} from "@/api/queries/lyrics";
import { queryClient } from "@/api/queryClient";
import { keys } from "@/api/queryKeys";
import { getTransport } from "@/contracts/transport";
import { isApiError } from "@/domain/api";
import type { SongId } from "@/domain/ids";
import type { Lyrics, LrcLine, LyricsTranslationTarget, LyricsWordLine } from "@/domain/lyrics";
import { useT } from "@/i18n";
import { activeLineIndex, estimatePosition, parseLrc } from "@/lyrics/lrc";
import { awaitJob, generateLyricsSync, type SyncOutcome, syncOutcome } from "@/lyrics/syncJob";
import { LINE_LEAD_S, wordsForLines, wordsSung } from "@/lyrics/words";
import {
  TRANSLATION_TARGET_OPTIONS,
  buildSyncedTranslationMap,
  plainTranslationFor,
  splitPlainLines,
  syncedTranslationFor,
} from "@/lyrics/translation";
import {
  getPlaybackView,
  subscribePlaybackView,
  usePlaybackView,
  type PlaybackView,
} from "@/remote/mirror";
import { withAlpha } from "@/theme/contrast";
import { useTheme } from "@/theme/provider";
import { BottomSheet, EmptyState, ErrorState, GhostIconButton, Icon, Skeleton } from "@/ui";
import {
  initialTranslationTarget,
  storeTranslationOn,
  storeTranslationTarget,
  translationWasOn,
} from "./targetStore";

const K = "components.music.LyricsView";

/** How long a manual scroll keeps the auto-follow suppressed (web parity). */
export const USER_SCROLL_GRACE_MS = 4000;

/** Empty timed lines render as a middle dot; still tappable (FR-76/78). */
const PLACEHOLDER_DOT = "·";

type SyncRun =
  | { songId: SongId; phase: "running" }
  | { songId: SongId; phase: "done"; ok: boolean; outcome: SyncOutcome };

/** A frase de cada desfecho da sync/geração (o servidor diz porquê). */
const SYNC_MESSAGE: Record<SyncOutcome, string> = {
  ok: "syncGenerated",
  unsynced: "generateUnsynced",
  no_match: "syncNoMatch",
  no_voice: "generateNoVoice",
  busy: "syncBusy",
  failed: "syncFailed",
};

/**
 * A synced line whose emphasis GLIDES: every line renders at the active font
 * size and the inactive ones shrink via transform, so activation animates
 * scale + opacity without changing layout - the measured heights the
 * auto-center math depends on stay constant per line.
 */
const SyncedLineText = ({
  active,
  color,
  children,
}: {
  active: boolean;
  color: string;
  children: React.ReactNode;
}) => {
  const p = useTween(active ? 1 : 0, { duration: 220 });
  const style = {
    opacity: p.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
    transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.87, 1] }) }],
  };
  return (
    <Animated.Text
      style={[
        style,
        {
          color,
          fontSize: 22,
          lineHeight: 30,
          fontWeight: "800",
          letterSpacing: -0.3,
          transformOrigin: "left center",
        },
      ]}
    >
      {children}
    </Animated.Text>
  );
};

/** O passo do acerto do dono, em milissegundos. */
const OFFSET_STEP_MS = 250;

/**
 * A linha activa palavra a palavra (2026-11-04): as palavras já cantadas
 * acendem, as que faltam ficam meio apagadas. Só ESTA linha re-renderiza, e
 * só quando mais uma palavra começa (umas poucas vezes por segundo).
 */
const ActiveWords = ({
  words,
  position,
  playing,
}: {
  words: LyricsWordLine["w"];
  position: () => number;
  playing: boolean;
}) => {
  const [sung, setSung] = useState(() => wordsSung(words, position()));
  useEffect(() => {
    let last = -1;
    const apply = (): void => {
      const next = wordsSung(words, position());
      if (next !== last) {
        last = next;
        setSung(next);
      }
    };
    apply();
    if (!playing) return;
    let frame = requestAnimationFrame(function tick(): void {
      apply();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [words, position, playing]);
  return (
    <>
      {words.map((word, k) => (
        <Text key={k} style={{ opacity: k < sung ? 1 : 0.45 }}>
          {k > 0 ? " " : ""}
          {word[2]}
        </Text>
      ))}
    </>
  );
};

export default function LyricsBody() {
  const t = useT();
  const { tokens } = useTheme();
  const focused = useIsFocused();
  const songId = usePlaybackView((v) => v.song?.id ?? null);
  const lyricsQuery = useLyrics(songId);

  const synced = lyricsQuery.data?.synced ?? null;
  const plain = lyricsQuery.data?.plain ?? null;
  const hasContent = !!(synced || plain);
  const lines = useMemo(() => (synced ? parseLrc(synced) : []), [synced]);
  const serverWords = lyricsQuery.data?.words ?? null;
  const lineWords = useMemo(() => wordsForLines(lines, serverWords), [lines, serverWords]);
  const canAdjust = lyricsQuery.data?.can_adjust === true;
  const offsetMs = lyricsQuery.data?.offset_ms ?? 0;
  const plainLines = useMemo(() => (plain ? splitPlainLines(plain) : []), [plain]);

  // ----- translation (FR-79) ------------------------------------------------
  const [showTranslation, setShowTranslation] = useState(translationWasOn);
  const [target, setTarget] = useState<LyricsTranslationTarget>(initialTranslationTarget);
  const [targetSheetOpen, setTargetSheetOpen] = useState(false);
  const translationQuery = useLyricsTranslation(songId, target, showTranslation && hasContent);
  const translationVisible = showTranslation && translationQuery.isSuccess;
  const translatedSynced = translationQuery.data?.synced ?? null;
  const translatedPlain = translationQuery.data?.plain ?? null;
  const translatedByTime = useMemo(
    () => buildSyncedTranslationMap(translatedSynced),
    [translatedSynced],
  );
  const translatedPlainLines = useMemo(
    () => (translatedPlain ? splitPlainLines(translatedPlain) : null),
    [translatedPlain],
  );

  const chooseTarget = (code: LyricsTranslationTarget): void => {
    setTarget(code);
    setShowTranslation(true);
    storeTranslationTarget(code);
    storeTranslationOn(true);
    setTargetSheetOpen(false);
  };

  // ----- "Traduzir de novo" e os acertos do dono (2026-11-04) ----------------
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"retranslate" | "refine" | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    setNotice(null);
  }, [songId]);

  const retranslate = (): void => {
    if (songId == null || busy) return;
    const forSong = songId;
    setTargetSheetOpen(false);
    setBusy("retranslate");
    retranslateLyrics(forSong, target)
      .then((fresh) => queryClient.setQueryData(keys.lyricsTranslation(forSong, target), fresh))
      .catch((error: unknown) =>
        setNotice(
          isApiError(error) && error.status === 429
            ? t(`${K}.translationLimit`)
            : t(`${K}.translationUnavailable`),
        ),
      )
      .finally(() => setBusy(null));
  };

  const nudge = (deltaMs: number): void => {
    if (songId == null) return;
    const forSong = songId;
    // O servidor devolve a letra já acertada (as marcas e as palavras).
    const previous = queryClient.getQueryData<Lyrics>(keys.lyrics(forSong));
    nudgeLyricsOffset(forSong, deltaMs)
      .then((fresh) => {
        queryClient.setQueryData(keys.lyrics(forSong), fresh);
        void queryClient.invalidateQueries({ queryKey: keys.lyricsTranslation(forSong, target) });
      })
      .catch(() => {
        if (previous) queryClient.setQueryData(keys.lyrics(forSong), previous);
        setNotice(t(`${K}.adjustFailed`));
      });
  };

  const refineByVoice = (): void => {
    if (songId == null || busy) return;
    const forSong = songId;
    setTargetSheetOpen(false);
    setBusy("refine");
    setNotice(t(`${K}.refineRunning`));
    refineLyrics(forSong)
      .then(({ job_id }) => awaitJob(job_id))
      .then(async (job) => {
        await queryClient.invalidateQueries({ queryKey: keys.lyrics(forSong) });
        setNotice(t(job.status === "complete" ? `${K}.refineDone` : `${K}.refineFailed`));
      })
      .catch(() => setNotice(t(`${K}.refineFailed`)))
      .finally(() => setBusy(null));
  };

  // ----- sync generation (FR-80) --------------------------------------------
  const [syncRun, setSyncRun] = useState<SyncRun | null>(null);
  const syncAbortRef = useRef<AbortController | null>(null);
  const syncing = syncRun?.phase === "running" && syncRun.songId === songId;

  useEffect(
    () => () => {
      syncAbortRef.current?.abort();
    },
    [],
  );

  // The done message clears itself after a few seconds.
  useEffect(() => {
    if (syncRun?.phase !== "done") return;
    const timer = setTimeout(() => {
      setSyncRun((current) => (current === syncRun ? null : current));
    }, 5000);
    return () => clearTimeout(timer);
  }, [syncRun]);

  const generateSync = (): void => {
    if (songId == null || syncing) return;
    const forSong = songId;
    const controller = new AbortController();
    syncAbortRef.current = controller;
    setSyncRun({ songId: forSong, phase: "running" });
    void (async () => {
      try {
        const job = await generateLyricsSync(forSong, { signal: controller.signal });
        const outcome = syncOutcome(job);
        if (job.status === "complete") {
          await queryClient.invalidateQueries({ queryKey: keys.lyrics(forSong) });
        }
        setSyncRun({ songId: forSong, phase: "done", ok: outcome === "ok", outcome });
      } catch {
        if (!controller.signal.aborted) {
          setSyncRun({ songId: forSong, phase: "done", ok: false, outcome: "failed" });
        }
      }
    })();
  };

  // ----- active line tracking (FR-77) ---------------------------------------
  // Frame-driven like the web rAF loop, but reading the PROJECTION instead of
  // the audio object (the mandated UI read path): its position slice ticks at
  // 4 Hz locally and 1 Hz while controlling, so between ticks the frame
  // extrapolates
  // `position + elapsed * rate` while playing. State is touched ONLY when the
  // active index actually changes (a few times per minute), so playback never
  // re-renders this screen per frame. The loop does not run while the route is
  // unfocused, while playback is paused, or when the song has no synced lines
  // (battery rule); the index resets to -1 whenever the parsed lines change
  // (song change).
  const clockRef = useRef({ position: 0, at: Date.now(), playing: false, rate: 1, duration: 0 });
  useEffect(() => {
    const sample = (view: PlaybackView): void => {
      clockRef.current = {
        position: view.position,
        at: Date.now(),
        playing: view.playing,
        rate: view.rate,
        duration: view.duration,
      };
    };
    let previous = getPlaybackView();
    sample(previous);
    return subscribePlaybackView(() => {
      const view = getPlaybackView();
      if (
        view.position !== previous.position ||
        view.playing !== previous.playing ||
        view.rate !== previous.rate ||
        view.duration !== previous.duration
      ) {
        sample(view);
      }
      previous = view;
    });
  }, []);

  const estimatedPosition = useCallback((): number => estimatePosition(clockRef.current, Date.now()), []);

  const playing = usePlaybackView((v) => v.playing);
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeIndexRef = useRef(-1);

  // Song change (new parsed lines) resets the active line, exactly like the
  // web: no stale line survives into the next track.
  useEffect(() => {
    activeIndexRef.current = -1;
    setActiveIndex(-1);
  }, [lines]);

  useEffect(() => {
    if (!focused || lines.length === 0) return;
    const apply = (): void => {
      const next = activeLineIndex(lines, estimatedPosition() + LINE_LEAD_S);
      if (next !== activeIndexRef.current) {
        activeIndexRef.current = next;
        setActiveIndex(next);
      }
    };
    apply();
    if (!playing) {
      // Paused: nothing to extrapolate, so no frame loop - only a seek moves
      // the line.
      let last = getPlaybackView().position;
      return subscribePlaybackView(() => {
        const position = getPlaybackView().position;
        if (position === last) return;
        last = position;
        apply();
      });
    }
    let frame = requestAnimationFrame(function tick(): void {
      apply();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [focused, lines, playing, estimatedPosition]);

  // ----- auto-center + manual-scroll grace ----------------------------------
  const scrollRef = useRef<ScrollView>(null);
  const viewportHeightRef = useRef(0);
  const lineLayoutsRef = useRef<({ y: number; height: number } | undefined)[]>([]);
  const userScrollUntilRef = useRef(0);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [suppressed, setSuppressed] = useState(false);

  // Layout offsets belong to the current line list; drop them on change.
  useEffect(() => {
    lineLayoutsRef.current = [];
  }, [lines]);

  useEffect(
    () => () => {
      if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    },
    [],
  );

  const markUserScroll = useCallback(() => {
    userScrollUntilRef.current = Date.now() + USER_SCROLL_GRACE_MS;
    setSuppressed(true);
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    suppressTimerRef.current = setTimeout(() => setSuppressed(false), USER_SCROLL_GRACE_MS);
  }, []);

  const resumeFollow = useCallback(() => {
    userScrollUntilRef.current = 0;
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    suppressTimerRef.current = null;
    setSuppressed(false);
  }, []);

  const scrollToLine = useCallback((index: number, animated: boolean) => {
    if (index < 0) return;
    const layout = lineLayoutsRef.current[index];
    const viewport = viewportHeightRef.current;
    if (!layout || viewport <= 0) return;
    const y = Math.max(0, layout.y - (viewport - layout.height) / 2);
    scrollRef.current?.scrollTo({ y, animated });
  }, []);

  // Center the active line whenever it changes, unless the user scrolled
  // within the grace window.
  useEffect(() => {
    if (activeIndex < 0) return;
    if (Date.now() < userScrollUntilRef.current) return;
    scrollToLine(activeIndex, true);
  }, [activeIndex, scrollToLine]);

  const onLinePress = useCallback(
    (line: LrcLine) => {
      getTransport().seek(line.time);
      resumeFollow();
    },
    [resumeFollow],
  );

  // ----- states -------------------------------------------------------------
  if (songId == null) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <EmptyState icon="music" text={t("components.music.QueuePanel.lyricsEmpty")} />
      </View>
    );
  }

  if (lyricsQuery.isLoading) {
    return (
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 24, gap: 14 }}>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} height={14} width={i % 3 === 1 ? "72%" : "88%"} />
        ))}
      </View>
    );
  }

  if (lyricsQuery.isError) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ErrorState text={t(`${K}.errorLoadingLyrics`)} />
      </View>
    );
  }

  if (!hasContent) {
    // Sem letra em lado nenhum, a mesma máquina do sync (FR-80) gera-a a
    // partir do áudio: o backend separa as vozes e o transcript do whisper
    // passa a ser a letra (plain + synced). O mesmo syncRun serve os dois
    // caminhos; no sucesso a invalidação da query troca esta view pela
    // letra sem mais estado.
    return (
      <View style={{ flex: 1, justifyContent: "center", gap: 20 }}>
        <EmptyState icon="music" text={t(`${K}.noLyricsFound`)} />
        {syncing ? (
          <View style={{ alignItems: "center", gap: 10, paddingHorizontal: 32 }}>
            <ActivityIndicator size="small" color={tokens.mutedForeground} />
            <Text style={{ color: tokens.mutedForeground, fontSize: 12, textAlign: "center" }}>
              {t(`${K}.generateRunning`)}
            </Text>
          </View>
        ) : (
          <View style={{ alignItems: "center", gap: 10 }}>
            {syncRun?.phase === "done" && !syncRun.ok && syncRun.songId === songId ? (
              <Text style={{ color: tokens.mutedForeground, fontSize: 12, textAlign: "center", paddingHorizontal: 32 }}>
                {t(syncRun.outcome === "failed" ? `${K}.generateFailed` : `${K}.${SYNC_MESSAGE[syncRun.outcome]}`)}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(`${K}.generateFromAudio`)}
              onPress={generateSync}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 18,
                paddingVertical: 10,
                borderRadius: 999,
                backgroundColor: tokens.secondary,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Icon name="audio-waveform" size={16} color={tokens.foreground} />
              <Text style={{ color: tokens.foreground, fontSize: 13, fontWeight: "700" }}>
                {t(`${K}.generateFromAudio`)}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  const translationError =
    showTranslation && translationQuery.isError
      ? isApiError(translationQuery.error) && translationQuery.error.status === 429
        ? t(`${K}.translationLimit`)
        : t(`${K}.translationUnavailable`)
      : null;
  const syncMessage =
    syncRun?.phase === "done" && syncRun.songId === songId
      ? t(`${K}.${SYNC_MESSAGE[syncRun.outcome]}`)
      : null;
  const inlineMessage = notice ?? translationError ?? syncMessage;

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingHorizontal: 16,
          minHeight: 44,
          gap: 4,
        }}
      >
        {inlineMessage ? (
          <Text
            numberOfLines={2}
            style={{ flex: 1, color: tokens.mutedForeground, fontSize: 12, textAlign: "right" }}
          >
            {inlineMessage}
          </Text>
        ) : null}
        {!synced && plain ? (
          syncing ? (
            <View style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator size="small" color={tokens.mutedForeground} />
            </View>
          ) : (
            <GhostIconButton
              icon="audio-waveform"
              onPress={generateSync}
              color={tokens.mutedForeground}
              accessibilityLabel={t(`${K}.generateSync`)}
            />
          )
        ) : null}
        <Pressable
          onPress={() => setTargetSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t(`${K}.translate`)}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          {(showTranslation && translationQuery.isFetching) || busy === "retranslate" ? (
            <ActivityIndicator size="small" color={tokens.primary} />
          ) : (
            <View
              style={{
                borderWidth: 1.5,
                borderColor: showTranslation ? tokens.primary : tokens.mutedForeground,
                borderRadius: 6,
                paddingHorizontal: 5,
                paddingVertical: 2,
              }}
            >
              <Text
                style={{
                  color: showTranslation ? tokens.primary : tokens.mutedForeground,
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 0.5,
                }}
              >
                {target.toUpperCase()}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        onLayout={(event: LayoutChangeEvent) => {
          viewportHeightRef.current = event.nativeEvent.layout.height;
        }}
        onScrollBeginDrag={markUserScroll}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 48 }}
        style={{ flex: 1 }}
      >
        {synced
          ? lines.map((line, i) => {
              // With a language selected the translation IS the lyric; the
              // original drops to the small line underneath.
              const translated = translationVisible
                ? syncedTranslationFor(translatedByTime, line)
                : null;
              const primary = translated ?? line.text;
              const secondary = translated ? line.text : null;
              const active = i === activeIndex;
              return (
                <Pressable
                  key={i}
                  onLayout={(event: LayoutChangeEvent) => {
                    lineLayoutsRef.current[i] = {
                      y: event.nativeEvent.layout.y,
                      height: event.nativeEvent.layout.height,
                    };
                  }}
                  onPress={() => onLinePress(line)}
                  accessibilityRole="button"
                  accessibilityLabel={t(`${K}.seekTo`, { line: primary || "" })}
                  style={{ paddingVertical: 5 }}
                >
                  <SyncedLineText active={active} color={tokens.foreground}>
                    {active && !translated && lineWords[i] ? (
                      <ActiveWords
                        words={lineWords[i] as LyricsWordLine["w"]}
                        position={estimatedPosition}
                        playing={playing}
                      />
                    ) : (
                      primary || PLACEHOLDER_DOT
                    )}
                  </SyncedLineText>
                  {secondary ? (
                    <Text
                      style={{
                        color: tokens.foreground,
                        opacity: active ? 0.7 : 0.4,
                        fontSize: 13,
                        lineHeight: 18,
                        marginTop: 2,
                      }}
                    >
                      {secondary}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })
          : plainLines.map((line, i) => {
              const translated = translationVisible
                ? plainTranslationFor(translatedPlainLines, i, line)
                : null;
              return (
                <View key={i} style={{ paddingVertical: 4 }}>
                  <Text
                    style={{ color: withAlpha(tokens.foreground, 0.85), fontSize: 18, lineHeight: 27, fontWeight: "600" }}
                  >
                    {translated ?? (line || PLACEHOLDER_DOT)}
                  </Text>
                  {translated ? (
                    <Text
                      style={{
                        color: tokens.foreground,
                        opacity: 0.5,
                        fontSize: 13,
                        lineHeight: 18,
                        marginTop: 2,
                      }}
                    >
                      {line}
                    </Text>
                  ) : null}
                </View>
              );
            })}
        <Text style={{ color: tokens.mutedForeground, fontSize: 12, paddingTop: 20 }}>
          {t(`${K}.attribution`, { source: lyricsQuery.data?.attribution || "" })}
        </Text>
      </ScrollView>

      {synced && suppressed ? (
        <Pressable
          onPress={() => {
            resumeFollow();
            scrollToLine(activeIndex, true);
          }}
          accessibilityRole="button"
          style={({ pressed }) => ({
            position: "absolute",
            bottom: 16,
            alignSelf: "center",
            backgroundColor: tokens.primary,
            borderRadius: 999,
            paddingHorizontal: 14,
            paddingVertical: 8,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ color: tokens.primaryForeground, fontSize: 12, fontWeight: "600" }}>
            {t(`${K}.backToCurrentLine`)}
          </Text>
        </Pressable>
      ) : null}

      <BottomSheet visible={targetSheetOpen} onClose={() => setTargetSheetOpen(false)}>
        {TRANSLATION_TARGET_OPTIONS.map((option) => (
          <Pressable
            key={option.code}
            onPress={() => chooseTarget(option.code)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 20,
              paddingVertical: 14,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ color: tokens.foreground, fontSize: 15 }}>{option.label}</Text>
            {showTranslation && target === option.code ? (
              <Icon name="check" size={18} color={tokens.primary} />
            ) : null}
          </Pressable>
        ))}
        {showTranslation ? (
          <>
            <View style={{ height: 1, backgroundColor: tokens.border, marginVertical: 4 }} />
            <Pressable
              onPress={() => {
                setShowTranslation(false);
                storeTranslationOn(false);
                setTargetSheetOpen(false);
              }}
              accessibilityRole="button"
              style={({ pressed }) => ({
                paddingHorizontal: 20,
                paddingVertical: 14,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ color: tokens.foreground, fontSize: 15 }}>
                {t(`${K}.translationOff`)}
              </Text>
            </Pressable>
            <Pressable
              onPress={retranslate}
              accessibilityRole="button"
              style={({ pressed }) => ({
                paddingHorizontal: 20,
                paddingVertical: 14,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ color: tokens.foreground, fontSize: 15 }}>{t(`${K}.retranslate`)}</Text>
            </Pressable>
          </>
        ) : null}
        {canAdjust && synced ? (
          <>
            <View style={{ height: 1, backgroundColor: tokens.border, marginVertical: 4 }} />
            <Text
              style={{
                color: tokens.mutedForeground,
                fontSize: 12,
                paddingHorizontal: 20,
                paddingTop: 10,
              }}
            >
              {t(`${K}.timingTitle`)}
              {offsetMs !== 0 ? ` · ${(offsetMs / 1000).toFixed(2).replace(".", ",")} s` : ""}
            </Text>
            {[
              { label: t(`${K}.lyricsEarly`), delta: OFFSET_STEP_MS },
              { label: t(`${K}.lyricsLate`), delta: -OFFSET_STEP_MS },
            ].map((row) => (
              <Pressable
                key={row.delta}
                onPress={() => nudge(row.delta)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  paddingHorizontal: 20,
                  paddingVertical: 14,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text style={{ color: tokens.foreground, fontSize: 15 }}>{row.label}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={refineByVoice}
              disabled={busy === "refine"}
              accessibilityRole="button"
              style={({ pressed }) => ({
                paddingHorizontal: 20,
                paddingVertical: 14,
                opacity: pressed || busy === "refine" ? 0.6 : 1,
              })}
            >
              <Text style={{ color: tokens.foreground, fontSize: 15 }}>{t(`${K}.refineByVoice`)}</Text>
            </Pressable>
          </>
        ) : null}
      </BottomSheet>
    </View>
  );
}
