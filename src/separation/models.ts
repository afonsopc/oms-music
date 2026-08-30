/**
 * Vocal separation model catalog: GET /vocal_separations/models returns the
 * whitelist `{ models: [{ id, translation_key, default }] }` (backend
 * vocal_separator_models initializer; the SDK unwraps the array). Model
 * names/descriptions resolve client-side under
 * components.music.Settings.SongsTable.EditSongDialog.models.<translation_key>.
 */
import { useQuery } from "@tanstack/react-query";
import type { ToolModel } from "@omelhorsite/sdk";
import { oms } from "@/api/oms";
import { guardedQueryFn } from "@/api/queries/common";
import { useAuthReady } from "@/auth/guard";

export type SeparationModel = ToolModel;

const MODELS_KEY = ["separation", "models"] as const;

export const listSeparationModels = (): Promise<SeparationModel[]> =>
  oms().tools.vocalSeparation.models();

export const useSeparationModels = (enabled = true) => {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: MODELS_KEY,
    queryFn: guardedQueryFn(MODELS_KEY, () => listSeparationModels()),
    enabled: authReady && enabled,
    staleTime: 60 * 60 * 1000,
  });
};

export const defaultModelId = (models: readonly SeparationModel[]): string | null =>
  (models.find((m) => m.default) ?? models[0])?.id ?? null;
