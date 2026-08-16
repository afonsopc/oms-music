/**
 * MODO KARAOKE do palco do player (handoff-cloud-backlog 274: "as peças
 * existem todas soltas; falta juntá-las numa vista"). As peças juntadas:
 *
 *  - letras sincronizadas GRANDES ao centro (api/queries/lyrics + lyrics/lrc),
 *    em teleponto: a linha activa em destaque com a vizinhança a meia-luz,
 *    sem o scroll livre da vista de letras - num palco de treino o texto vem
 *    ter contigo, não és tu que o persegues;
 *  - voz a 0% / 50% / 100% sobre os modos de stem que já existem
 *    (player/modes.ts): 0% é o ficheiro instrumental, 100% é o original, e o
 *    50% é o blend custom com vocalVolume 0.5 - só quando o mixer desta
 *    build existe, senão os dois extremos chegam (on/off);
 *  - velocidade 0.5x..1x SEM desafinar: o engine ganhou setPitchCorrection
 *    (session-only) porque o FR-64 desafina de propósito e treinar uma letra
 *    meio tom abaixo não ensina ninguém.
 *
 * Entrar/sair é montar/desmontar este corpo (o palco troca no PlayerPager):
 * o efeito de montagem tira uma fotografia de modo + velocidade + volumes e
 * a limpeza devolve TUDO como estava - o karaoke é um empréstimo, nunca uma
 * escrita nas preferências.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useLyrics } from "@/api/queries/lyrics";
import { getTransport } from "@/contracts/transport";
import type { LrcLine } from "@/domain/lyrics";
import { useIsOffline } from "@/features/shell/OfflineBanner";
import { useT } from "@/i18n";
import { activeLineIndex, parseLrc } from "@/lyrics/lrc";
import { getPlayerEngine } from "@/player/register";
import { stemModeResidentLocally } from "@/player/sources";
import { playerStore, usePlayerStore } from "@/player/store";
import {
  getPlaybackView,
  subscribePlaybackView,
  usePlaybackView,
  type PlaybackView,
} from "@/remote/mirror";
import { useRemoteStore, type RemoteStoreState } from "@/remote/store";
import { useTheme } from "@/theme/provider";
import { EmptyState, Skeleton } from "@/ui";
import { Chip, NoteLine, SliderRow } from "./sheetControls";

const K = "native.player";

/** Gama de treino: só abrandar. 1x é o tecto porque acelerar não é ensaiar. */
const KARAOKE_MIN_RATE = 0.5;
const KARAOKE_MAX_RATE = 1;
/** Passo do slider; 0.05 chega para "um bocadinho mais devagar". */
const RATE_STEP = 0.05;

const clampRate = (r: number): number =>
  Math.min(KARAOKE_MAX_RATE, Math.max(KARAOKE_MIN_RATE, r));

const fractionToKaraokeRate = (fraction: number): number => {
  const raw = KARAOKE_MIN_RATE + fraction * (KARAOKE_MAX_RATE - KARAOKE_MIN_RATE);
  return clampRate(Math.round(raw / RATE_STEP) * RATE_STEP);
};

const karaokeRateToFraction = (rate: number): number =>
  (clampRate(rate) - KARAOKE_MIN_RATE) / (KARAOKE_MAX_RATE - KARAOKE_MIN_RATE);

const selectIsController = (s: RemoteStoreState): boolean => s.role === "controller";

/** Os três degraus da voz; o do meio só existe com o mixer nesta build. */
type VoiceLevel = 0 | 0.5 | 1;

/**
 * Aplica um degrau de voz por cima das peças que já existem. 0% e 100% são
 * trocas de FICHEIRO (instrumental / original) e funcionam em qualquer
 * build; o 50% precisa do blend, que só o mixer nativo sabe fazer.
 */
const applyVoiceLevel = (level: VoiceLevel): void => {
  const engine = getPlayerEngine();
  if (level === 0.5) {
    engine.setVocalVolume(0.5);
    engine.setInstrumentalVolume(1);
    engine.setPlaybackMode("custom");
    return;
  }
  engine.setPlaybackMode(level === 0 ? "instrumental" : "original");
};

export default function KaraokeBody() {
  const t = useT();
  const { tokens } = useTheme();
  const song = usePlaybackView((v) => v.song);
  const songId = song?.id ?? null;
  const lyricsQuery = useLyrics(songId);
  // Num controlador o áudio é de OUTRO dispositivo: mexer no modo de stem ou
  // na velocidade daqui escrevia estado que ninguém ouve (FR-109), por isso
  // os controlos apagam-se e a fotografia de entrada nem se tira.
  const localDisabled = useRemoteStore(selectIsController);

  const playbackMode = usePlayerStore((s) => s.playbackMode);
  const vocalVolume = usePlayerStore((s) => s.vocalVolume);
  const stemMixerAvailable = usePlayerStore((s) => s.stemMixerAvailable);
  const rate = usePlayerStore((s) => s.rate);

  const stemsReady = !!song && !song.jam_song &&
    !!song.vocals_media_id && !!song.instrumental_media_id;

  const offline = useIsOffline();
  // Costura stem/cache (player/sources.ts, mesma regra do separationSection):
  // offline, um degrau cujo ficheiro de stem não está no disco tocaria o mixed
  // cacheado - o chip desliga-se e a nota diz porquê, em vez de fingir que o
  // modo funciona. 0% é o ficheiro instrumental; 50% é o blend e precisa dos
  // DOIS stems (modeUsesStem não cobre "custom", daí o par explícito); 100% é
  // o mixed, que a cache de reprodução guarda, e nunca cai aqui.
  const voiceLevelOfflineUnavailable = (level: VoiceLevel): boolean => {
    if (!offline || !song) return false;
    if (level === 0) return !stemModeResidentLocally(song, "instrumental");
    if (level === 0.5) {
      return (
        !stemModeResidentLocally(song, "instrumental") ||
        !stemModeResidentLocally(song, "vocals")
      );
    }
    return false;
  };
  const someVoiceLevelOffline =
    stemsReady &&
    (voiceLevelOfflineUnavailable(0) ||
      (stemMixerAvailable && voiceLevelOfflineUnavailable(0.5)));

  // ----- fotografia de entrada / restauro na saída ---------------------------
  // Depende do papel de propósito: o handoff para outro dispositivo pode
  // acontecer COM o karaoke aberto, e nesse instante o empréstimo tem de
  // acabar - virar controlador corre a limpeza (restauro completo) e a guarda
  // impede nova fotografia; voltar a ser o dispositivo activo tira uma
  // fotografia fresca, como se o modo tivesse acabado de abrir.
  useEffect(() => {
    if (localDisabled) return;
    const engine = getPlayerEngine();
    const before = playerStore.getState();
    const snapshot = {
      playbackMode: before.playbackMode,
      rate: before.rate,
      vocalVolume: before.vocalVolume,
      instrumentalVolume: before.instrumentalVolume,
    };
    engine.setPitchCorrection(true);
    // A gama do karaoke acaba em 1x; um 1.25x herdado tocaria fora do slider.
    if (before.rate > KARAOKE_MAX_RATE) engine.setRate(KARAOKE_MAX_RATE);
    return () => {
      // Ordem deliberada: primeiro o pitch shift do FR-64 volta, depois os
      // valores do utilizador por cima - setRate/set*Volume persistem, e é
      // isso que garante que o empréstimo nunca sobrevive à sessão.
      engine.setPitchCorrection(false);
      engine.setRate(snapshot.rate);
      engine.setVocalVolume(snapshot.vocalVolume);
      engine.setInstrumentalVolume(snapshot.instrumentalVolume);
      engine.setPlaybackMode(snapshot.playbackMode);
    };
  }, [localDisabled]);

  // ----- letras sincronizadas ------------------------------------------------
  const synced = lyricsQuery.data?.synced ?? null;
  const lines = useMemo(() => (synced ? parseLrc(synced) : []), [synced]);

  // Relógio extrapolado igual ao da vista de letras (FR-77): a projecção
  // tica a 4 Hz e entre ticks a frame estima `position + elapsed * rate`;
  // o estado só muda quando o índice activo muda.
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
    sample(getPlaybackView());
    return subscribePlaybackView(() => sample(getPlaybackView()));
  }, []);

  const estimatedPosition = useCallback((): number => {
    const clock = clockRef.current;
    if (!clock.playing) return clock.position;
    const elapsed = (Date.now() - clock.at) / 1000;
    const estimate = clock.position + elapsed * (clock.rate || 1);
    return clock.duration > 0 ? Math.min(estimate, clock.duration) : estimate;
  }, []);

  const playing = usePlaybackView((v) => v.playing);
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeIndexRef = useRef(-1);

  useEffect(() => {
    activeIndexRef.current = -1;
    setActiveIndex(-1);
  }, [lines]);

  useEffect(() => {
    if (lines.length === 0) return;
    const apply = (): void => {
      const next = activeLineIndex(lines, estimatedPosition());
      if (next !== activeIndexRef.current) {
        activeIndexRef.current = next;
        setActiveIndex(next);
      }
    };
    apply();
    if (!playing) {
      // Em pausa só um seek move a linha; nada de frame loop (regra de
      // bateria do FR-77).
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
  }, [lines, playing, estimatedPosition]);

  const onLinePress = useCallback((line: LrcLine) => {
    getTransport().seek(line.time);
  }, []);

  // ----- nível de voz derivado do estado real --------------------------------
  // Derivado, não guardado: se o modo mudar por fora (cog, remoto), os chips
  // contam a verdade em vez de uma intenção antiga.
  const voiceLevel: VoiceLevel =
    playbackMode === "instrumental"
      ? 0
      : playbackMode === "custom"
        ? vocalVolume <= 0.25
          ? 0
          : vocalVolume < 0.75
            ? 0.5
            : 1
        : 1;

  const voiceDisabled = localDisabled || !stemsReady;

  // ----- teleponto -----------------------------------------------------------
  // Janela fixa à volta da linha activa em vez do scroll medido da vista de
  // letras: aqui o texto é grande, as linhas são poucas no ecrã e a janela
  // nunca deixa a activa fugir do centro - sem medições nem corridas de
  // layout. Antes da primeira linha (índice -1) mostra-se o arranque.
  const windowStart = Math.max(0, (activeIndex < 0 ? 0 : activeIndex) - 1);
  const windowLines = lines.slice(windowStart, windowStart + 4);

  const lyricsStage = (() => {
    if (songId == null) {
      return <EmptyState icon="mic" text={t("components.music.QueuePanel.lyricsEmpty")} />;
    }
    if (lyricsQuery.isLoading) {
      return (
        <View style={{ gap: 18, paddingHorizontal: 24 }}>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={22} width={i % 2 === 1 ? "64%" : "84%"} />
          ))}
        </View>
      );
    }
    if (lines.length === 0) {
      // Sem letra SINCRONIZADA não há teleponto; a geração vive na vista de
      // letras (FR-80) e é para lá que a dica aponta.
      return <EmptyState icon="mic" text={t(`${K}.karaokeNoSyncedLyrics`)} />;
    }
    return (
      <View style={{ gap: 6, paddingHorizontal: 24 }}>
        {windowLines.map((line, i) => {
          const index = windowStart + i;
          const active = index === activeIndex;
          return (
            <Pressable
              key={index}
              onPress={() => onLinePress(line)}
              accessibilityRole="button"
              accessibilityLabel={t("components.music.LyricsView.seekTo", {
                line: line.text || "",
              })}
              style={{ paddingVertical: 6 }}
            >
              <Text
                style={{
                  color: tokens.foreground,
                  opacity: active ? 1 : 0.4,
                  fontSize: active ? 30 : 19,
                  lineHeight: active ? 38 : 26,
                  fontWeight: active ? "800" : "600",
                  textAlign: "center",
                }}
              >
                {line.text || "·"}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  })();

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, justifyContent: "center" }}>{lyricsStage}</View>

      <View style={{ paddingHorizontal: 24, paddingBottom: 4 }}>
        {/* Voz: três degraus sobre os modos de stem. O 50% desaparece (em
            vez de mentir) quando esta build não tem mixer - on/off chega. */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <Text
            style={{
              color: tokens.mutedForeground,
              fontSize: 12,
              fontWeight: "700",
              marginRight: 4,
            }}
          >
            {t(`${K}.karaokeVoice`)}
          </Text>
          <Chip
            label="0%"
            selected={voiceLevel === 0}
            disabled={voiceDisabled || voiceLevelOfflineUnavailable(0)}
            onPress={() => applyVoiceLevel(0)}
          />
          {stemMixerAvailable ? (
            <Chip
              label="50%"
              selected={voiceLevel === 0.5}
              disabled={voiceDisabled || voiceLevelOfflineUnavailable(0.5)}
              onPress={() => applyVoiceLevel(0.5)}
            />
          ) : null}
          <Chip
            label="100%"
            selected={voiceLevel === 1}
            disabled={localDisabled}
            onPress={() => applyVoiceLevel(1)}
          />
        </View>
        {!stemsReady ? <NoteLine text={t(`${K}.stemsMissing`)} /> : null}
        {someVoiceLevelOffline ? <NoteLine text={t(`${K}.modeUnavailableOffline`)} /> : null}

        <SliderRow
          label={t(`${K}.speed`)}
          valueLabel={`${clampRate(rate).toFixed(2)}x`}
          value={karaokeRateToFraction(rate)}
          disabled={localDisabled}
          onChange={(fraction) => getTransport().setRate(fractionToKaraokeRate(fraction))}
        />
      </View>
    </View>
  );
}
