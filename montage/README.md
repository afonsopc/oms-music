# O motor da Montagem (`/montage/`)

Edições ao estilo AMV no visualizador em ecrã inteiro (2026-11-04): clipes
de vídeo cortados ao ritmo da música. Como o `/viz/`: TypeScript simples +
WebGL2, sem dependências, construído pelo `scripts/build-web.sh` para
`public/montage/`; num iframe na web e no computador, num WebView no iOS e
no Android (`src/features/montage/MontageFrame*`).

- `timeline.ts`: a montagem em si, pura e testada (`__tests__`). Da análise
  da música (batidas, energia; `GET /songs/:id/analysis`), dos clipes e da
  semente sai a lista de troços: corta nas batidas (mais vezes com mais
  energia), nas subidas grandes de energia (drops) uma rajada a meia batida,
  clarão, zoom, cores partidas, rampa de velocidade e um clipe ainda não
  visto; prefere começar um clipe logo a seguir a uma mudança de cena
  (`cuts`, do scdet no núcleo). A mesma semente dá a mesma montagem.
- `main.ts`: os clipes descarregam-se para a memória (blobs), três `<video>`
  mudos em rodízio (o actual, o seguinte já no sítio, um de reserva) seguem a
  posição da música (velocidade por troço, acerto acima de 250 ms) e um
  shader desenha com clarão, zoom de soco, abanão, cores partidas, negativo
  (caos), grão e vinheta. "Reduzir movimento" tira os efeitos.
- Estilos: `fast` (cortes rápidos), `slow` (lento e emotivo, câmara lenta e
  zoom devagar) e `chaos`.

Os clipes estão no núcleo (`GET /montage_clips`, `GET/PUT
/songs/:id/montage`, mp4 só imagem no Garage em `clips/`). Ir buscar clipes
novos é do serviço de importação e só existe na web e no computador
(`src/features/montage/clipSource.web.ts`); nas apps da loja a Montagem só
usa a biblioteca. Ver `docs/app-store.md`.
