/**
 * O que liga o motor da Montagem (/montage/) à app, igual nas duas
 * plataformas: quando ele diz "ready", manda a reprodução (a mesma medição
 * do visualizador), a análise da música e a montagem.
 */
import { useEffect, useRef, useState } from "react";
import { getPlaybackView, subscribePlaybackView, usePlaybackView } from "@/remote/mirror";
import { useReducedMotion } from "@/ui/motion";
import type { FromMontage, MontageSpec, ToMontage } from "../../../montage/protocol";
import { useSongAnalysis } from "../viz/analysis";
import { noteTick, stateMessage } from "../viz/vizMessages";

/** O estado da reprodução quando muda e de 2 em 2 s (o motor interpola). */
const followState = (send: (m: ToMontage) => void): (() => void) => {
  let lastKey = "";
  let lastSent = 0;
  const push = (force = false) => {
    const v = getPlaybackView();
    const key = `${v.song?.id ?? ""}|${v.playing}`;
    const now = Date.now();
    if (force || key !== lastKey || now - lastSent >= 1000) {
      lastKey = key;
      lastSent = now;
      const m = stateMessage();
      if (m.type === "state") send({ type: "state", playing: m.playing, position: m.position, at: m.at });
    }
  };
  push(true);
  const unsub = subscribePlaybackView(() => {
    noteTick();
    push();
  });
  const id = setInterval(() => push(), 1000);
  return () => {
    unsub();
    clearInterval(id);
  };
};

export const useMontageDriver = (send: (msg: ToMontage) => void, spec: MontageSpec | null, onMessage?: (m: FromMontage) => void) => {
  const [ready, setReady] = useState(false);
  const song = usePlaybackView((v) => v.song);
  const songId = song ? String(song.id) : null;
  const analysis = useSongAnalysis(songId);
  const reduceMotion = useReducedMotion();
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const handle = (msg: FromMontage) => {
    if (msg.type === "ready") setReady(true);
    onMessage?.(msg);
  };

  useEffect(() => {
    if (!ready) return;
    return followState((m) => sendRef.current(m));
  }, [ready]);

  useEffect(() => {
    if (!ready || !songId) return;
    const data = analysis.data?.status === "ready" ? analysis.data.data : null;
    sendRef.current({ type: "analysis", songId, duration: song?.duration ?? null, data });
  }, [ready, songId, song?.duration, analysis.data]);

  // o motor ignora uma montagem igual à que já tem
  useEffect(() => {
    if (ready) sendRef.current({ type: "montage", spec });
  }, [ready, spec]);

  useEffect(() => {
    if (ready) sendRef.current({ type: "config", reduceMotion });
  }, [ready, reduceMotion]);

  return { onMessage: handle, ready };
};
