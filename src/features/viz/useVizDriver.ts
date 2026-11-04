/**
 * O que liga o motor à app, igual nas duas plataformas: quando o motor diz
 * "ready", manda cores, estado, análise e configuração; depois segue a
 * reprodução e as mudanças de props. Só o transporte muda (iframe/WebView).
 */
import { useEffect, useRef, useState } from "react";
import { songArtworkSource } from "@/domain/artwork";
import { usePlaybackView } from "@/remote/mirror";
import { useArtworkAccent } from "@/theme/useArtworkTint";
import { artworkSourceUri } from "@/ui";
import { useReducedMotion } from "@/ui/motion";
import type { FromViz, ToViz } from "../../../viz/protocol";
import { useSongAnalysis } from "./analysis";
import type { VizFrameProps } from "./VizFrame.types";
import { followPlayback, paletteFrom } from "./vizMessages";

export const useVizDriver = (send: (msg: ToViz) => void, props: VizFrameProps) => {
  const [ready, setReady] = useState(false);
  const song = usePlaybackView((v) => v.song);
  const songId = song ? String(song.id) : null;
  const uri = song ? artworkSourceUri(songArtworkSource(song)) : null;
  const accent = useArtworkAccent(songId, uri);
  const analysis = useSongAnalysis(songId);
  const reduceMotion = useReducedMotion();
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const onMessage = (msg: FromViz) => {
    if (msg.type === "ready") setReady(true);
    props.onMessage?.(msg);
  };

  useEffect(() => {
    if (!ready) return;
    return followPlayback((m) => sendRef.current(m));
  }, [ready]);

  useEffect(() => {
    if (ready) sendRef.current({ type: "palette", colors: paletteFrom(accent) });
  }, [ready, accent]);

  useEffect(() => {
    if (!ready || !songId) return;
    const data = analysis.data?.status === "ready" ? analysis.data.data : null;
    sendRef.current({ type: "analysis", songId, data });
  }, [ready, songId, analysis.data]);

  const { mode, scene, chaos, fx, paused, autoCycleBars } = props;
  const fxKey = JSON.stringify(fx ?? {});
  useEffect(() => {
    if (!ready) return;
    sendRef.current({ type: "config", mode, scene, chaos, fx: JSON.parse(fxKey), paused, reduceMotion, autoCycleBars });
  }, [ready, mode, scene, chaos, fxKey, paused, reduceMotion, autoCycleBars]);

  const step = props.stepToken;
  useEffect(() => {
    if (ready && step && step.n > 0) sendRef.current({ type: "next", dir: step.dir });
  }, [ready, step]);

  return { onMessage, ready };
};
