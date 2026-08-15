/**
 * Gate de sistema de ficheiros para a arvore de rotas das tabs nativas
 * (2026-08-15), no espirito do gates.test.ts: pina as invariantes que a
 * migracao inteira assume e que se partem em silencio, sem erro de
 * compilacao nem teste vermelho noutro sitio.
 *
 *  1. Nenhuma rota ficou irma do navegador de tabs. Se voltar a ficar, a
 *     barra do sistema desaparece nesse ecra - que e exactamente o bug que
 *     esta migracao veio resolver.
 *  2. O ficheiro raiz de cada tab chama-se como o grupo ((home)/home.tsx).
 *     O anchor de cada copia do layout partilhado e derivado dai pelo
 *     expo-router (getRoutesCore procura um filho cujo `route` iguala o nome
 *     do grupo); renomear para index.tsx faria o anchor evaporar-se sem uma
 *     unica mensagem de erro.
 *  3. A pasta partilhada tem exactamente as 21 rotas empurradas. Uma rota
 *     nova criada fora dela nao ganha barra; a lista literal obriga a
 *     decisao a ser explicita.
 *
 * Vive em boot/__tests__ e nao em app/__tests__ porque o require.context do
 * expo-router varre src/app inteiro e apanharia o proprio ficheiro de teste
 * como se fosse uma rota.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

const APP_ROOT = new URL("../../app/", import.meta.url).pathname;
const MAIN = join(APP_ROOT, "(main)");
const TABS = join(MAIN, "(tabs)");
const SHARED = join(TABS, "(home,search,library)");

/** Nomes directos de uma pasta, com "/" a marcar as sub-pastas. */
const entries = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort();

/** Todos os ficheiros de rota abaixo de `dir`, relativos a `dir`. */
const routeFiles = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
};

/** As 21 rotas que sao empurradas por cima de qualquer tab. */
const PUSHED_ROUTES = [
  // O perfil e uma rota empurrada, alcancavel de qualquer tab pelo avatar do
  // cabecalho (features/shell/HeaderAvatar). Ja foi tab e ja foi gaveta.
  "account.tsx",
  "album/[artist]/[album].tsx",
  "artist/[artist].tsx",
  "artists-roster.tsx",
  "artists.tsx",
  "friends.tsx",
  "liked.tsx",
  "mix/[slug].tsx",
  "playlist/[id].tsx",
  "playlists.tsx",
  "profile/[idOrHandle].tsx",
  "radio/artist/[artist].tsx",
  "radio/song/[id].tsx",
  "settings/artists.tsx",
  "settings/devices.tsx",
  "settings/downloads-overview.tsx",
  "settings/downloads.tsx",
  "settings/import.tsx",
  "settings/index.tsx",
  "settings/passkeys.tsx",
  "settings/playback.tsx",
  "settings/songs.tsx",
].sort();

describe("route tree (native tabs)", () => {
  it("keeps nothing but the tabs host and the dev gallery beside (tabs)", () => {
    // A gallery e a unica excepcao aprovada: e __DEV__, nao e alcancavel por
    // UI nenhuma, e triplica-la pelas tres tabs so engordava o export.
    expect(entries(MAIN)).toEqual(["(tabs)/", "_layout.tsx", "gallery.tsx"]);
  });

  it("forks the tabs layout by platform and groups every tab", () => {
    expect(entries(TABS)).toEqual([
      "(home)/",
      "(home,search,library)/",
      "(library)/",
      "(search)/",
      "_layout.tsx",
      "_layout.web.tsx",
    ]);
  });

  it("names each tab root exactly like its group, so the anchor resolves", () => {
    expect(entries(join(TABS, "(home)"))).toEqual(["home.tsx"]);
    expect(entries(join(TABS, "(search)"))).toEqual(["search.tsx"]);
    expect(entries(join(TABS, "(library)"))).toEqual(["library.tsx"]);
  });

  it("puts every pushed screen inside the shared group", () => {
    expect(routeFiles(SHARED)).toEqual(["_layout.tsx", ...PUSHED_ROUTES].sort());
  });
});
