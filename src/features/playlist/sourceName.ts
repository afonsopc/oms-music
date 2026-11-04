import type { Playlist } from "@/domain/playlist";

/**
 * O nome do serviço de onde vem uma playlist sincronizada. iOS e Android:
 * nunca (as apps da loja não nomeiam serviços de fora, docs/app-store.md);
 * a web e o computador em ./sourceName.web.ts.
 */
export const sourceName = (_playlist: Playlist): string | null => null;
