# O motor visual da OMS Music (`/viz/`)

Ronda 2 do redesenho (2026-11-04). Os visuais que reagem à música vivem
aqui, fora da app React: TypeScript simples + WebGL/Canvas, sem dependências,
construído por `bun build` para `public/viz/` (o `scripts/build-web.sh` fá-lo
antes do export). A app carrega-o só quando é preciso:

- web e computador: num `<iframe src="/viz/">` (mesma origem);
- iOS e Android: num `WebView` a apontar para `https://music.omelhorsite.pt/viz/`.

Um só motor para todas as plataformas e nada disto no bundle principal.

## Dados

A app manda mensagens (`postMessage`) com o estado da reprodução (música,
posição, a tocar), a análise da música (`GET /songs/:id/analysis`, feita no
backend por `Music::AudioAnalysis`: energia e 4 faixas a 25/s, batidas,
ataques, BPM) e a configuração (cena, fundo ou ecrã inteiro, modo caos,
efeitos, reduzir movimento, poupança). O motor corre o seu próprio relógio a
partir da posição e da hora em que foi medida.

FFT ao vivo na web: não. O `<audio>` da app não é carregado com
`crossOrigin`, e um `AnalyserNode` sobre um elemento assim fica mudo (e
calava a música). Fica a análise pré-calculada, igual em todo o lado.

## Cenas

Um ficheiro por cena em `scenes/<pacote>/<id>.ts`, cada um com o seu `meta`
(nome, famílias, etiquetas, intensidade, custo, sinais, estilo da letra) e
o código (`shaderScene`, `canvasScene`, `domScene` ou `defineScene`). O
índice `scenes/_registry.ts` é gerado (`bun viz/tools/registry.ts`, corre
sozinho no build, nos testes e no typecheck) e não vai para o git; cada
cena é um pedaço de JS à parte, carregado quando entra, e a seguinte do
baralho pré-carrega-se (e o shader dela compila) enquanto a actual toca.
Como fazer uma: [`scenes/README.md`](scenes/README.md).

Pacotes de agora: `campos` (aurora, que é o fundo do leitor, retorno,
plasma, metal líquido, tinta, galáxia, synthwave, cidade de voxels,
fogo-de-artifício), `capa` (caleidoscópio, túnel, cromado, VHS, película,
datamosh, colagem) e `retro` (canos, Mystify, estrelas, osciloscópio,
vectores, 8 bits, chuva de terminal, título 3D, ambiente de trabalho).
Efeitos: CRT, aberração cromática, píxeis, pontilhado.

Escolha (`selector.ts`): um baralho guardado no aparelho (12 h), por isso
nenhuma volta antes de quase todas terem passado, de música para música;
favoritas duas vezes por volta, banidas nunca; "pelo estilo" fica na
família da música e dá peso às etiquetas que batem com os géneros; a
intensidade da cena aproxima-se da da secção; o refrão que volta traz a
cena do primeiro; o nível do aparelho (1..3) tira as cenas caras e desce
sozinho se uma se arrastar. A app recebe a lista do motor (mensagem
`catalog`), por isso as cenas novas aparecem sem build novo da app.

## Galeria e testes

- `bun run viz:gallery`: `http://localhost:5179/?gallery` com a música e a
  capa de teste (`lib/canned.ts`); também em produção em `/viz/?gallery`.
- `bun run viz:shots`: cada cena num Chrome sem janela (GPU a sério),
  captura, vídeo de 5 s e tempo por frame, em `viz/.shots/index.html`.
- `bun run viz:test`: entra, 120 frames, sai limpo, dentro do orçamento do
  custo dela (`BUDGET_MS` em `tools/shots.ts`).
- `bun viz/tools/compare.ts <antes> <agora>`: dois builds cena a cena com o
  relógio parado (serviu para provar que a separação em ficheiros não mudou
  o aspecto).

Desempenho: resolução limitada (DPR até 1,5; poupança 1 e 60 % da área), pausa
com a página escondida ou quando a app manda, "reduzir movimento" desenha uma
imagem parada. O motor manda à app o tempo dos frames (média e p95).
