/**
 * Gate do mapeamento deep link -> rota (FR-20, metade da registacao). Ate
 * 2026-08-15 esta funcao nao tinha cobertura nenhuma: so o PARSER a tinha
 * (lib/__tests__/deepLinks.test.ts), e foi ela que ficou com a regra mais
 * subtil da migracao para native tabs.
 *
 * A regra: ao contrario de lib/routes.ts, aqui o prefixo de grupo e
 * EXPLICITO. Cada rota das tabs existe agora tres vezes (uma stack por tab) e
 * o expo-router desempata as copias comparando os segmentos de grupo da
 * POSICAO ACTUAL. Um deep link nao tem posicao de que se fie - a app pode
 * estar fechada ou aberta noutra tab qualquer - por isso sem o grupo o mesmo
 * URL aterrava em tabs diferentes conforme o estado. Nomear o grupo torna o
 * destino determinista.
 */
import { describe, expect, it } from "bun:test";
import { parseDeepLink, type DeepLinkTarget } from "@/lib/deepLinks";
import { routeForDeepLinkUrl, routeForTarget } from "../deepLinkRoute";

/** O grupo da tab Inicio: o destino de tudo o que nao e a Pesquisa. */
const HOME = "/(main)/(tabs)/(home)";

describe("routeForTarget", () => {
  it("mapeia cada kind para a sua rota exacta", () => {
    const cases: [DeepLinkTarget, string][] = [
      [{ kind: "home" }, `${HOME}/home`],
      [{ kind: "liked" }, `${HOME}/liked`],
      [{ kind: "artists" }, `${HOME}/artists`],
      [{ kind: "playlists" }, `${HOME}/playlists`],
      [{ kind: "search", query: null }, "/(main)/(tabs)/(search)/search"],
      [
        { kind: "search", query: "carlos paiao" },
        "/(main)/(tabs)/(search)/search?query=carlos%20paiao",
      ],
      [{ kind: "playlist", id: 12 }, `${HOME}/playlist/12`],
      [{ kind: "mix", slug: "top_artist:123" }, `${HOME}/mix/top_artist%3A123`],
      [{ kind: "radioArtist", artist: "Rui Veloso" }, `${HOME}/radio/artist/Rui%20Veloso`],
      [{ kind: "radioSong", id: 7 }, `${HOME}/radio/song/7`],
      [{ kind: "artist", artist: "Xutos & Pontapes" }, `${HOME}/artist/Xutos%20%26%20Pontapes`],
      [
        { kind: "album", artist: "carlos-paiao", album: "Play Back", highlight: null },
        `${HOME}/album/carlos-paiao/Play%20Back`,
      ],
      [{ kind: "settings", page: "import" }, `${HOME}/settings/import`],
      [{ kind: "settings", page: "songs" }, `${HOME}/settings/songs`],
      [{ kind: "settings", page: "artists" }, `${HOME}/settings/artists`],
      [{ kind: "settings", page: "playback" }, `${HOME}/settings/playback`],
      [{ kind: "settings", page: "downloads" }, `${HOME}/settings/downloads`],
    ];
    for (const [target, route] of cases) {
      expect(routeForTarget(target)).toBe(route);
    }
  });

  // O segmento literal "null" e informacao, nao ausencia: o ecra do album
  // traduz artista/album nulos para "sem artista de contexto" e para
  // exact_search[album]="\b" (so as musicas sem album).
  it("preserva os segmentos literais null do album", () => {
    expect(
      routeForTarget({ kind: "album", artist: null, album: null, highlight: null }),
    ).toBe(`${HOME}/album/null/null`);
    expect(
      routeForTarget({ kind: "album", artist: "carlos-paiao", album: null, highlight: null }),
    ).toBe(`${HOME}/album/carlos-paiao/null`);
  });

  it("leva o highlight do #hash como query param (FR-44)", () => {
    expect(
      routeForTarget({
        kind: "album",
        artist: "carlos-paiao",
        album: "Play Back",
        highlight: "Cinderela",
      }),
    ).toBe(`${HOME}/album/carlos-paiao/Play%20Back?highlight=Cinderela`);
  });

  // Os nomes chegam DECODIFICADOS do parser e saem daqui como um path, nao
  // como um Href em forma de objecto: quem codifica e este ficheiro, uma vez
  // so. Codificar duas vezes daria "Rui%2520Veloso", que nenhuma lookup
  // resolve.
  it("codifica uma unica vez os segmentos que vem do parser", () => {
    expect(routeForDeepLinkUrl("omsmusic://artist/Rui%20Veloso")).toBe(
      `${HOME}/artist/Rui%20Veloso`,
    );
    expect(routeForDeepLinkUrl("omsmusic://mix?slug=top_artist%3A123")).toBe(
      `${HOME}/mix/top_artist%3A123`,
    );
  });
});

describe("prefixo de grupo explicito", () => {
  /**
   * A matriz do e2e/deeplinks.ts, que e o que o operador dispara a mao contra
   * um simulador. Duplicada de proposito: se o e2e ganhar um caso novo e este
   * gate nao souber dele, so um dos dois falha, e e essa a discrepancia que
   * interessa apanhar.
   */
  const URLS = [
    "omsmusic://discover",
    "omsmusic://liked",
    "omsmusic://artists",
    "omsmusic://playlists",
    "omsmusic://search?query=carlos",
    "omsmusic://playlist?id=1",
    "omsmusic://playlist?id=abc",
    "omsmusic://artist/carlos-paiao",
    "omsmusic://artist/Carlos%20Paiao",
    "omsmusic://artist/null",
    "omsmusic://artist/carlos-paiao/Play%20Back",
    "omsmusic://album/carlos-paiao/Play%20Back",
    "omsmusic://album/carlos-paiao/null",
    "omsmusic://album/carlos-paiao/Play%20Back#Cinderela",
    "omsmusic://mix?slug=top_artist%3A123",
    "omsmusic://radio/artist?artist=carlos-paiao",
    "omsmusic://radio/song?id=1",
    "omsmusic://radio/song",
    "omsmusic://settings",
    "omsmusic://settings/songs",
    "omsmusic://settings/downloads",
    "https://omelhorsite.pt/pt/music/playlist?id=1",
    "https://omelhorsite.pt/en/music/album/carlos-paiao/Play%20Back",
  ];

  it("nomeia sempre a tab, para toda a matriz do e2e", () => {
    for (const url of URLS) {
      const route = routeForDeepLinkUrl(url);
      expect(route).not.toBeNull();
      // Sem grupo o destino ficava a merce da tab que estivesse focada.
      expect((route as string).startsWith("/(main)/(tabs)/(")).toBe(true);
    }
  });

  it("manda tudo para a tab Inicio, menos a Pesquisa", () => {
    for (const url of URLS) {
      const route = routeForDeepLinkUrl(url) as string;
      const search = parseDeepLink(url)?.kind === "search";
      // A Pesquisa e o unico ecra que nao vive na stack do Inicio: o
      // search.tsx e a raiz da SUA tab, por isso um link para ela tem de
      // nomear (search) - com (home) nao havia rota nenhuma para casar e o
      // router caia no +not-found.
      expect(route.startsWith(search ? "/(main)/(tabs)/(search)/" : `${HOME}/`)).toBe(true);
    }
  });

  it("devolve null para URLs que nao sao da area de musica", () => {
    expect(routeForDeepLinkUrl("omsmusic://unknown")).toBeNull();
    expect(routeForDeepLinkUrl("https://omelhorsite.pt/pt/arcade")).toBeNull();
  });
});
