/**
 * A análise da música para os visuais (GET /songs/:id/analysis, feita no
 * backend por Music::AudioAnalysis). 202 = ainda a fazer: volta a perguntar
 * de 6 em 6 s durante um minuto. Uma por música, em cache da react-query.
 */
import { useQuery } from "@tanstack/react-query";
import { API_BASE_URL } from "@/api/oms";
import { isCookieAuth } from "@/auth/authMode";
import { getToken } from "@/auth/token";
import { useAuthReady } from "@/auth/guard";
import type { VizAnalysis } from "../../../viz/protocol";

export type AnalysisResult = { status: "ready"; data: VizAnalysis } | { status: "pending" } | { status: "none" };

export const fetchSongAnalysis = async (songId: string | number): Promise<AnalysisResult> => {
  const cookie = isCookieAuth();
  const token = cookie ? null : getToken();
  const res = await fetch(`${API_BASE_URL}/songs/${encodeURIComponent(String(songId))}/analysis`, {
    credentials: cookie ? "include" : "omit",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (res.status === 202) return { status: "pending" };
  if (!res.ok) return { status: "none" };
  const body = (await res.json()) as VizAnalysis & { failed?: boolean };
  if (body.failed || !body.env) return { status: "none" };
  return { status: "ready", data: body };
};

export const useSongAnalysis = (songId: string | number | null, enabled = true) => {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ["songs", "analysis", songId == null ? "none" : String(songId)],
    queryFn: () => fetchSongAnalysis(songId as string | number),
    enabled: authReady && enabled && songId != null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60_000,
    retry: 1,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status !== "pending") return false;
      return query.state.dataUpdateCount < 10 ? 6000 : false;
    },
  });
};
