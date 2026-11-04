/**
 * Arranque optimista (redesenho 2026-11-04). A sessão e a conta da última
 * vez ficam guardadas; no arranque seguinte a app entra logo com elas, a
 * biblioteca em cache pinta no primeiro frame, e o GET /music/session corre
 * por trás: um 401 tira a sessão como sempre (wipeToAnon), uma falha de rede
 * deixa ficar a conta guardada.
 *
 * Só quando não há troca de sessão antiga pendente: no nativo, um token da
 * música; numa origem cookie, o browser que já passou pela troca.
 */
import { kvGetJson, kvRemove, kvSetJson } from "@/db/kv";
import type { Session, User } from "@/domain/user";

export const BOOT_SNAPSHOT_KV_KEY = "oms-music.boot-snapshot";

export interface BootSnapshot {
  session: Session;
  user: User;
}

export const canBootOptimistically = ({
  cookie,
  migrated,
  token,
  isMusicToken,
}: {
  cookie: boolean;
  migrated: boolean;
  token: string | null;
  isMusicToken: (token: string) => boolean;
}): boolean => (cookie ? migrated : !!token && isMusicToken(token));

const valid = (snap: unknown): snap is BootSnapshot => {
  const s = snap as BootSnapshot | null;
  return !!s && typeof s === "object" && !!s.user?.id && !!s.session && s.session.user_id === s.user.id;
};

export const readBootSnapshot = (): BootSnapshot | null => {
  const snap = kvGetJson<BootSnapshot>(BOOT_SNAPSHOT_KV_KEY);
  return valid(snap) ? snap : null;
};

export const writeBootSnapshot = (session: Session, user: User): void => {
  if (!user?.id || session?.user_id !== user.id) return;
  kvSetJson(BOOT_SNAPSHOT_KV_KEY, { session, user });
};

export const clearBootSnapshot = (): void => kvRemove(BOOT_SNAPSHOT_KV_KEY);
