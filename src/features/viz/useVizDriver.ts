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
import { useVizLyrics } from "./vizLyrics";
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

  const { mode, scene, chaos, fx, paused, selection, cycleOnTrack, lyrics } = props;
  const fxKey = JSON.stringify(fx ?? {});
  const favKey = JSON.stringify(props.favorites ?? []);
  const banKey = JSON.stringify(props.banned ?? []);
  useEffect(() => {
    if (!ready) return;
    sendRef.current({
      type: "config",
      mode,
      scene,
      chaos,
      fx: JSON.parse(fxKey),
      paused,
      reduceMotion,
      lyrics,
      selection,
      favorites: JSON.parse(favKey),
      banned: JSON.parse(banKey),
      cycleOnTrack,
    });
  }, [ready, mode, scene, chaos, fxKey, paused, reduceMotion, lyrics, selection, favKey, banKey, cycleOnTrack]);

  // A letra (palavra a palavra quando o servidor a tem; com "tradução"
  // ligada, as linhas traduzidas), só no ecrã inteiro.
  const lines = useVizLyrics(mode === "full" ? songId : null);
  useEffect(() => {
    if (!ready || !songId || mode !== "full") return;
    sendRef.current({ type: "lyrics", songId, lines });
  }, [ready, songId, lines, mode]);

  const step = props.stepToken;
  useEffect(() => {
    if (ready && step && step.n > 0) sendRef.current({ type: "next", dir: step.dir });
  }, [ready, step]);

  return { onMessage, ready };
};
