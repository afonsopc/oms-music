# Fazer cenas para o visualizador

Cada cena é **um ficheiro**: `viz/scenes/<pacote>/<id>.ts`. Não há listas
para editar: o índice (`_registry.ts`) é gerado a partir dos ficheiros e não
vai para o git. Cria o ficheiro, corre a galeria e os testes, faz commit.

## Em três passos

1. Copia um modelo abaixo para `viz/scenes/<o-teu-pacote>/<id>.ts` (o `id` é
   o nome do ficheiro).
2. `bun run viz:gallery` e abre `http://localhost:5179/?gallery&scene=<id>`.
3. `VIZ_ONLY=<id> bun run viz:test` (ou `VIZ_PACK=<pacote>`) tem de passar;
   `bun run viz:shots -- --pack=<pacote>` deixa capturas e vídeos em `viz/.shots/`.

## Nomes

- `id`: minúsculas, algarismos e hífenes, 2 a 32 caracteres (`neon-rain`),
  **igual ao nome do ficheiro** e único em todos os pacotes. Não se muda
  depois de publicado: as favoritas e as banidas das pessoas guardam o id.
- Pacote: uma pasta com o mesmo formato (`natureza`, `tipografia`). Um
  pacote novo é só uma pasta nova; não há mais nada a registar.
- `name`: português de Portugal, grafia antiga (pré-AO90): "Electricidade",
  "Acção", "Óptica". Curto (até ~22 caracteres), é o que aparece na app.
  `names.en` e `names.lv` são facultativos.
- Ficheiros começados por `_` numa pasta de pacote são ajudantes desse
  pacote (`_shared.ts`), não cenas.

## O `meta`

```ts
{
  id: "neon-rain",
  name: "Chuva de néon",
  names: { en: "Neon rain" },          // facultativo
  families: ["electronic", "chaos"],  // calm | electronic | chaos | retro (pelo menos uma)
  tags: ["néon", "cidade", "noite"],  // livres; se baterem com os géneros da música, pesam mais
  intensity: 4,                        // 1 contemplativo ... 5 frenético
  cost: 1,                             // 1 leve, 2 médio, 3 pesado (ver Desempenho)
  signals: ["bass", "beat", "drop"],   // o que usa (informativo, aparece na galeria)
  lyrics: "neon",                      // extrude | glitch | ascii | neon | ink | own
  artwork: "overlay",                  // facultativo: "own" se a cena já mostra a capa e não a quer tapada
}
```

- `families` decide em que músicas a cena entra no modo "pelo estilo da
  música": `calm` (fado, acústico, jazz, lo-fi), `electronic` (house,
  techno, synth), `chaos` (hardstyle, hyperpop, metal, glitch), `retro`
  (computador antigo, protectores de ecrã, consolas).
- `intensity`: o escolhedor aproxima-a da intensidade da secção que começa
  (uma queda puxa cenas 4-5, uma intro 1-2).
- `lyrics`: o estilo da letra que aparece por cima; `own` se a cena desenha
  a letra ela própria (`env.lyric`), e então a camada de letra esconde-se.

## Modelos

### Shader (a maioria das cenas: rápido, bonito, uma só passagem)

```ts
/** Uma linha a dizer o que é. */
import { GLSL_HEAD, shaderScene } from "../../lib/shader";

export default shaderScene({
  id: "anel", name: "Anel", families: ["electronic"], tags: ["geométrico"],
  intensity: 3, cost: 1, signals: ["bass", "beat", "drop", "palette"], lyrics: "neon",
}, GLSL_HEAD + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float r = length(p);
  float ring = smoothstep(.02,.0, abs(r - (.2 + .15*B + .1*BEAT)));
  vec3 c = pal(r - T*.1) * ring * (1. + 2.*DROP);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
```

Uniformes (todos `float` salvo indicação): `R` (vec2, resolução), `T`
tempo, `E` energia, `B` graves, `LM` médios-graves, `M` médios, `H`
agudos, `BEAT`, `BAR`, `ON` (ataque), `DROP`, `SEC` (intensidade da
secção), `SECAGE` (segundos desde o início da secção), `C1 C2 C3` (vec3,
as cores da capa), `COVER` (sampler2D, a capa), `PREV` (o frame anterior,
só com `{ feedback: true }` como terceiro argumento). Funções: `hash`,
`noise`, `fbm`, `rot`, `pal(t)` (as três cores em ciclo), `pixuv(uv)` e
`post(c, gl_FragCoord.xy)`: **usa sempre as duas**, são os efeitos
"píxeis" e "pontilhado" que a pessoa liga na app.

### Canvas 2D

O exemplo completo é `campos/fogo.ts` (fogo-de-artifício: partículas,
batida, compasso, quedas). O esqueleto:

```ts
import { canvasScene } from "../../lib/canvas";
import { BeatEdge } from "../../lib/beat";

export default canvasScene({ id: "x", /* ... */ lyrics: "ink" }, () => {
  const edge = new BeatEdge();        // estado e memória: aqui, uma vez
  const pts = new Float32Array(2000);
  return {
    reset() { /* o tamanho mudou */ },
    frame(ctx, w, h, dt, t, s, env) {
      ctx.fillStyle = "rgba(0,0,0,.2)"; // rasto
      ctx.fillRect(0, 0, w, h);
      if (edge.hit(s)) { /* uma vez por batida */ }
    },
  };
});
```

`w`/`h` estão em píxeis do canvas (até DPR 2). O motor pinta o canvas de
preto e repõe o estado do contexto quando a cena entra.

### DOM (texto e CSS 3D)

`domScene(meta, () => ({ mount(host, env), frame(dt, t, s, env, w, h), unmount() }))`,
como `retro/text3d.ts`. Cria os elementos no `mount`, no `frame` só mexe
em `transform`/`opacity`/`filter`, tira tudo no `unmount` (o teste verifica
que a camada fica vazia). Escapa o texto que vem das pessoas com
`escapeHtml` (`lib/text.ts`).

### À mão (WebGL com geometria, vários passes)

`defineScene({ meta: { ..., layer: "gl" }, create: () => ({ init(host), resize(w, h), frame(t, s, f), dispose() }) })`.
`host.gl` é o contexto WebGL2 partilhado: cria os teus buffers/programas no
`init` (`cachedProgram` de `lib/gl.ts` para programas de ecrã inteiro),
apaga-os no `dispose`, e devolve o estado como o encontraste (blend, depth,
framebuffer `null`). `host.env.coverTex` é a capa: não a apagues.

## Os sinais (`s` no `frame`, ver `viz/signal.ts`)

| campo | o que é | para quê |
|---|---|---|
| `energy` | volume geral, 0..1, suavizado | brilho, velocidade geral |
| `bass` `lowmid` `mid` `high` | as 4 faixas, 0..1 | tamanho (graves), textura (médios), faíscas (agudos) |
| `beat` | 1 na batida, cai para 0 em ~150 ms | pulsar, saltar |
| `beatPos` / `bar` | batidas / compassos desde o início, com fracção | rodar no compasso, mudar a cada 4 |
| `onset` | 1 num ataque forte, cai depressa | cortes, flashes, glitch |
| `drop` | 1 no início de uma queda/refrão, cai em ~1,5 s | a explosão grande |
| `section` | `intro` `verse` `build` `drop` `chorus` `high` `breakdown` `outro` (`none` sem análise) | mudar de modo dentro da cena |
| `sectionIntensity` `sectionAge` `sectionIndex` `sectionGroup` | 0..1, segundos, índice, grupo (o refrão que volta tem o mesmo) | crescer ao longo da subida, repetir o refrão igual |
| `time` `bpm` `real` | posição na música, andamento, há análise a sério | |

Sem análise (ainda a chegar) o sinal respira devagar (`real: false`) e a
cena tem de continuar bonita.

Ajudantes em `lib/beat.ts`: `BeatEdge`/`BarEdge` (verdadeiro uma vez por
batida/compasso), `SectionEdge` (mudou de secção; `.big` se é queda),
`Trigger` (um nível passou um limiar), `Envelope` (ataque/queda à medida),
`pulse(s)`, `beatPhase(s)`, `barPhase(s)`, `isPeak(s)`, `isCalm(s)`,
`weight(s)` (o "peso" do momento, para escalar tudo de uma vez).

Receitas:
- **batida**: escala `1 + .15*s.beat`; ou `if (edge.hit(s))` para lançar algo.
- **graves**: tamanho, zoom e velocidade; os graves são o corpo.
- **queda**: `s.drop` para a explosão (cor, partículas, flash); `SectionEdge` para mudar de modo.
- **subida** (`section === "build"`): cresce com `sectionAge` até à queda.
- **calma** (`isCalm(s)`): menos movimento, mais espaço.

## Ajudantes em `viz/lib/`

| ficheiro | o quê |
|---|---|
| `scene.ts` | os tipos (`SceneMeta`, `SceneEnv`, `SceneHost`...) e `defineScene` |
| `shader.ts` | `shaderScene`, `GLSL_HEAD` |
| `canvas.ts`, `dom.ts` | `canvasScene`, `domScene` |
| `gl.ts` | `compile`, `cachedProgram`, `uniforms`, `textureFrom`, `target` (framebuffer), `sharedTriangle`, `hexToVec` |
| `beat.ts` | batidas, compassos, secções, envolventes |
| `ease.ts` | `clamp`, `lerp`, `smoothstep`, `damp` (independente dos fps), `easeOut*`, `bump` |
| `noise.ts` | `noise2`, `noise3`, `fbm2`, `hash2` (Perlin em JS) |
| `random.ts` | `rand`, `rng(seed)` (repetível), `randInt`, `pick` |
| `palette.ts` | `css(vec, alpha)`, `palInto`, `mixInto`, `hsl`, `hexToRgb`, `paletteFromImage` |
| `text.ts` | `wrap`, `fitSize`, `textCanvas` (texto para textura), `uploadTexture`, `escapeHtml`, fontes `WIDE`/`MONO` |
| `math3d.ts` | `mat4`, `perspective`, `lookAt`, `multiply`, `rotationXYZ`, `rotateYX`, `project` (escrevem em `out`) |
| `particles.ts` | `Particles`: arrays tipados, `emit`/`step`/`forEach`, sem alocar |
| `canned.ts` | a música e a capa de teste (galeria e testes) |

O `env` (`host.env` ou o último argumento no Canvas/DOM): `colors` (hex),
`colorVecs` (0..1, a deslizar entre músicas), `cover` (imagem), `coverTex`
(textura), `title`, `artist`, `lyric` (a linha que está a tocar), `tier`
(1..3), `lowPower`, `reduceMotion`. É do motor: lê, não guardes cópias.

## Desempenho (obrigatório)

- **GPU primeiro.** Shader de ecrã inteiro > Canvas 2D > DOM. No Canvas, sem
  `shadowBlur` grande em muitas formas, sem gradientes novos por elemento.
- **Resolução**: o motor já limita o DPR (1,5 no WebGL, 2 no Canvas; 1 e 60 %
  da área em poupança). Não aumentes; com `env.lowPower` desenha menos.
- **Nada de alocar no frame**: sem `new`, `[...]`, `{...}`, `map`/`filter`,
  strings montadas em ciclos. Arrays tipados criados no `create`. O teste
  mede a memória por frame (KB/frame, ~2 é o próprio motor).
- **Orçamento** (`BUDGET_MS` em `viz/tools/shots.ts`): tempo por frame no
  Mac de referência (M3, 1280x720), a mediana de lotes de 12 frames com uma
  espera pela GPU no fim: custo 1 até 2,5 ms, custo 2 até 6 ms, custo 3 até
  12 ms; e todas a 60 fps a correr no rAF (intervalo médio até 20 ms). Um
  telemóvel médio é ~10x mais lento: custo 1 tem de correr nele; custo 3 só
  entra em computadores (o motor tira as caras nos aparelhos fracos e desce
  de nível sozinho se uma cena se arrastar). As 23 de origem ficam abaixo de
  1,4 ms. No 2D e no DOM o número é o do processador; a GPU conta no
  intervalo entre frames.
- **Pausa**: o motor pára o frame com a página escondida e quando a app
  manda; não uses `setInterval`/`setTimeout` teus (usa `t`/`dt`).
- **Reduzir movimento**: o motor desenha um frame parado (`t` parado,
  `beat`/`onset`/`drop` a 0). Esse frame tem de ser bonito sozinho; nada de
  ecrã preto à espera de movimento.
- Raymarching: até ~80 passos e fórmulas curtas; acima disso é custo 2 ou 3.

## Regras de conteúdo

- Original. Pode inspirar-se num género (protector de ecrã, demoscene),
  nunca copiar uma obra concreta.
- A capa e as três cores são da música: usa-as, a cena muda de cor com cada
  música.
- O texto de que precisares em português de Portugal pré-AO90.
- Nada de som: o motor não toca nada e as cenas também não.
- Sem rede: nada de fetch, fontes ou imagens de fora (só o que o `env` dá).

## Verificar

```sh
bun run viz:gallery                              # http://localhost:5179/?gallery (setas; h esconde o painel)
VIZ_ONLY=neon-rain,anel bun run viz:test         # entra, 120 frames, sai limpo, dentro do orçamento
VIZ_PACK=natureza bun run viz:test
bun run viz:shots -- --pack=natureza             # capturas + vídeos em viz/.shots/ (index.html)
bun test viz                                     # meta válido, ids únicos, o escolhedor
```

A galeria tem "Secções mudam a cena" (para ver as trocas), "Letra" (os
estilos de letra por cima) e "Do início da queda" (salta para os 27 s, 3 s
antes da queda da música de teste).

## Commits

Outros agentes estão a fazer o mesmo no repo: `git status` antes, só
adiciona os teus ficheiros (`git add viz/scenes/<pacote>/`), `git pull
--rebase` antes de cada push. Como não há listas partilhadas, não há
conflitos.
