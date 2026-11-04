/**
 * O contrato de uma cena. Cada cena é um ficheiro `viz/scenes/<pacote>/<id>.ts`
 * com um `export default` deste tipo (ver viz/scenes/README.md). O índice
 * (`viz/scenes/_registry.ts`) é gerado por `viz/tools/registry.ts` a partir
 * dos ficheiros: ninguém edita listas à mão.
 *
 * Regra: um ficheiro de cena não toca no DOM nem no WebGL ao ser importado;
 * tudo o que cria fica dentro de `create()`/`init()`. O gerador importa os
 * ficheiros em Bun, sem browser, para ler o `meta`.
 */
import type { Signal } from "../signal";

export type { Signal };

/** As famílias, para escolher "pelo estilo da música". Uma cena pode estar em mais de uma. */
export const FAMILIES = ["calm", "electronic", "chaos", "retro"] as const;
export type SceneFamily = (typeof FAMILIES)[number];

/** Onde a cena desenha: o canvas WebGL2, o canvas 2D ou uma camada de DOM. */
export type SceneLayer = "gl" | "2d" | "dom";

/** O estilo da letra por cima da cena; "own": a cena desenha a letra ela própria (a camada de letra fica escondida). */
export type LyricStyle = "extrude" | "glitch" | "ascii" | "neon" | "ink" | "own";

/** Os sinais que a cena usa (informativo: a galeria mostra-os; ajuda a escolher cenas para músicas sem análise). */
export type SignalUse =
  | "energy" | "bass" | "lowmid" | "mid" | "high"
  | "beat" | "bar" | "onset" | "section" | "drop"
  | "cover" | "palette" | "title" | "lyric";

export interface SceneMeta {
  /** Igual ao nome do ficheiro: minúsculas, algarismos e hífenes (`neon-rain`). Único em todos os pacotes. */
  id: string;
  /** Nome em pt-PT (pré-AO90), como aparece na app. */
  name: string;
  /** Traduções opcionais do nome. */
  names?: { en?: string; lv?: string };
  families: SceneFamily[];
  /** Ambientes/temas, livres e em minúsculas ("escuro", "quente", "3d", "capa", "texto", "natureza"...). Se uma etiqueta da música bater, a cena ganha peso no modo "pelo estilo". */
  tags: string[];
  /** 1 contemplativo ... 5 frenético. O escolhedor aproxima-a da intensidade da secção. */
  intensity: 1 | 2 | 3 | 4 | 5;
  /** Custo: 1 leve (qualquer telemóvel), 2 médio (raymarching curto, DOM pesado), 3 pesado (só computadores). */
  cost: 1 | 2 | 3;
  layer: SceneLayer;
  signals: SignalUse[];
  /** Estilo da camada de letra por cima desta cena. */
  lyrics: LyricStyle;
  /** A capa a entrar por cima nos momentos grandes: "overlay" (por omissão) ou "own" (a cena já mostra a capa a seu modo, não a tapar). */
  artwork?: "overlay" | "own";
  /** Só para o fundo do leitor (aurora); fica fora da rotação do ecrã inteiro. */
  background?: boolean;
}

/** O que muda de música para música, partilhado e mutado pelo motor (não guardar cópias). */
export interface SceneEnv {
  /** As três cores da capa (#rrggbb). */
  colors: [string, string, string];
  /** As mesmas, 0..1, a deslizar suavemente para as novas quando a música muda. */
  colorVecs: [number, number, number][];
  title: string;
  artist: string;
  cover: HTMLImageElement | null;
  /** A capa como textura WebGL (null sem CORS ou sem capa). Do motor: não apagar. */
  coverTex: WebGLTexture | null;
  /** A linha da letra que está a tocar ("" sem letra). */
  lyric: string;
  /**
   * As palavras dessa linha com o tempo de cada uma em s da música
   * ([início, fim, palavra], pela ordem do texto), ou null quando a letra só
   * tem o tempo da linha. Comparar com `lyricTime`, nunca com o `t` da cena.
   */
  lyricWords: [number, number, string][] | null;
  /** O instante da letra que se ouve agora (s da música, já com o atraso do aparelho). */
  lyricTime: number;
  lowPower: boolean;
  /** Nível do aparelho: 1 fraco, 2 médio, 3 forte. */
  tier: 1 | 2 | 3;
  reduceMotion: boolean;
  /** Efeitos pedidos pela app que as cenas de shader aplicam elas próprias (PIX, DITHER). */
  fx: { pixel: boolean; dither: boolean };
}

export interface SceneHost {
  layer: SceneLayer;
  /** O contexto WebGL2 partilhado (camada "gl"). Repor o estado que se muda (blend, framebuffer) antes de sair do frame. */
  gl: WebGL2RenderingContext | null;
  /** O contexto 2D (camada "2d"). */
  ctx: CanvasRenderingContext2D | null;
  /** O elemento onde as cenas DOM se montam (camada "dom"); a cena tira o que lá pôs no `dispose`. */
  root: HTMLElement;
  env: SceneEnv;
}

export interface FrameInfo {
  /** Segundos desde o frame anterior (até 0,1). */
  dt: number;
  /** Tamanho da camada em píxeis (canvas) ou em CSS px (DOM). */
  w: number;
  h: number;
}

export interface SceneInstance {
  init?(host: SceneHost): void | Promise<void>;
  /** A camada mudou de tamanho. Depois do `init` também é chamado uma vez. */
  resize?(w: number, h: number): void;
  /** `t`: segundos do relógio do motor (pára com "reduzir movimento"). */
  frame(t: number, s: Signal, f: FrameInfo): void;
  /** Música nova (título, capa, cores já actualizados no env). */
  song?(): void;
  dispose?(): void;
}

export interface SceneModule {
  meta: SceneMeta;
  create(): SceneInstance;
  /** Facultativo: preparar o que custa (compilar shaders) antes de a cena entrar. */
  prewarm?(gl: WebGL2RenderingContext): void;
}

/** O que o índice gerado guarda por cena: o meta (sem carregar o código) e como carregá-la. */
export interface RegistryEntry {
  meta: SceneMeta;
  pack: string;
  load: () => Promise<{ default: SceneModule }>;
}

/** Para escrever cenas à mão com o tipo certo. */
export const defineScene = (m: SceneModule): SceneModule => m;

export const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;

/** Os erros do meta (vazio: está bem). O gerador e os testes usam isto. */
export const metaErrors = (m: SceneMeta, file?: string): string[] => {
  const e: string[] = [];
  if (!m || typeof m !== "object") return ["sem meta"];
  if (!ID_RE.test(m.id ?? "")) e.push(`id inválido "${m.id}" (minúsculas, algarismos, hífenes)`);
  if (file && m.id !== file) e.push(`o id "${m.id}" tem de ser igual ao nome do ficheiro "${file}"`);
  if (!m.name || typeof m.name !== "string") e.push("falta o nome");
  if (!Array.isArray(m.families) || m.families.length === 0) e.push("pelo menos uma família");
  else for (const f of m.families) if (!FAMILIES.includes(f)) e.push(`família desconhecida "${f}"`);
  if (!Array.isArray(m.tags)) e.push("tags tem de ser uma lista");
  if (![1, 2, 3, 4, 5].includes(m.intensity)) e.push("intensity de 1 a 5");
  if (![1, 2, 3].includes(m.cost)) e.push("cost de 1 a 3");
  if (!["gl", "2d", "dom"].includes(m.layer)) e.push(`layer inválida "${m.layer}"`);
  if (!Array.isArray(m.signals)) e.push("signals tem de ser uma lista");
  if (!["extrude", "glitch", "ascii", "neon", "ink", "own"].includes(m.lyrics)) e.push(`lyrics inválido "${m.lyrics}"`);
  if (m.artwork && !["overlay", "own"].includes(m.artwork)) e.push(`artwork inválido "${m.artwork}"`);
  return e;
};

/**
 * A palavra acende um pouco antes do seu tempo: a transição do "on" leva
 * ~60 ms a chegar ao brilho todo. O mesmo na camada de letra e nas cenas que
 * desenham a letra elas próprias.
 */
export const WORD_LEAD_S = 0.03;
