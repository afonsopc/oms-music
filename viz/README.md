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

`aurora` (fundo do leitor), `milk` (retorno com deformação), `kaleido`,
`tunnel` (a capa num túnel), `chrome` (cubo/toro cromado com a capa), `plasma`,
`pipes` (canos 3D), `text3d` (o título extrudido a girar, o motivo do antigo
nome do omelhorsite), `mystify`, `starfield`, `scope` (osciloscópio néon) e
`desktop` (janelas a aparecer e a falhar). Efeitos: CRT, aberração cromática,
píxeis, pontilhado.

Desempenho: resolução limitada (DPR até 1,5; poupança 1 e 60 % da área), pausa
com a página escondida ou quando a app manda, "reduzir movimento" desenha uma
imagem parada. O motor manda à app o tempo dos frames (média e p95).
