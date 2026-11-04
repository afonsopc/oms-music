/**
 * A montagem da música que está a tocar: a que se está a fazer agora (store)
 * ou a guardada no núcleo (GET /songs/:id/montage, em cache da react-query).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthReady } from "@/auth/guard";
import { usePlaybackView } from "@/remote/mirror";
import type { MontageSpec } from "../../../montage/protocol";
import { getSongMontage, montageQueryKey, type MontageAnswer } from "./api";
import { useMontageState } from "./store";

export const specFrom = (songId: string, answer: MontageAnswer | undefined): MontageSpec | null => {
  const m = answer?.montage;
  if (!m || !answer.clips.length) return null;
  return { songId, clips: answer.clips, seed: m.seed, style: m.style };
};

export const useSavedMontage = (songId: string | null) => {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: montageQueryKey(songId),
    queryFn: () => getSongMontage(songId as string),
    enabled: authReady && songId != null,
    // os endereços dos clipes valem 6 h
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
    retry: 1,
  });
};

export const useCurrentMontage = (): { songId: string | null; spec: MontageSpec | null; on: boolean } => {
  const song = usePlaybackView((v) => v.song);
  const songId = song ? String(song.id) : null;
  const { on, live } = useMontageState();
  const saved = useSavedMontage(songId);
  const fromSaved = useMemo(() => (songId ? specFrom(songId, saved.data) : null), [songId, saved.data]);
  const spec = songId && live?.songId === songId ? live : fromSaved;
  return { songId, spec, on };
};
