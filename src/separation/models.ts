/**
 * Vocal separation model catalog: GET /vocal_separations/models returns the
 * whitelist `{ models: [{ id, translation_key, default }] }` (backend
 * vocal_separator_models initializer). Model names/descriptions resolve
 * client-side under components.music.Settings.SongsTable.EditSongDialog
 * .models.<translation_key>.
 *
 * NOTE: the request fn lives here (not in src/api/endpoints) because the
 * endpoint modules are WP1-frozen; moving it into endpoints/separation.ts is
 * a pending change request to the foundation owner.
 */
import { useQuery } from "@tanstack/react-query";
import { request } from "@/api/client";
import { guardedQueryFn } from "@/api/queries/common";
import { useAuthReady } from "@/auth/guard";

export interface SeparationModel {
  id: string;
  translation_key: string;
  default?: boolean;
}

const MODELS_KEY = ["separation", "models"] as const;

export const listSeparationModels = (): Promise<{ models: SeparationModel[] }> =>
  request("GET", "/vocal_separations/models");

export const useSeparationModels = (enabled = true) => {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: MODELS_KEY,
    queryFn: guardedQueryFn(MODELS_KEY, () => listSeparationModels()),
    enabled: authReady && enabled,
    staleTime: 60 * 60 * 1000,
  });
};

export const defaultModelId = (models: SeparationModel[]): string | null =>
  (models.find((m) => m.default) ?? models[0])?.id ?? null;
