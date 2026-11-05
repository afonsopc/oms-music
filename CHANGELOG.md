# OMS Music: versões

Uma versão para a app inteira: iOS, Android, web e desktop levam o mesmo número.
Sobe-se com `bun run version:bump patch|minor|major` (docs/DEVELOPMENT.md, "Versões").
O que entra vai para "Por lançar"; o bump dá-lhe o número.

## Por lançar

- Chromecast com os visuais na TV: a app usa o receptor próprio da OMS Music (App ID 92D04F41) em vez do do Google. Enquanto não for publicado na consola do Google, só abre nos Chromecasts registados lá como aparelhos de teste (docs/cast.md).

## 2.1.0 (2026-11-04)

- Transmitir para TVs e colunas: um botão, uma lista com os teus aparelhos, Chromecast, AirPlay e TVs DLNA. O leitor diz "A tocar em Sala (Chromecast)".
- Chromecast na web (Chrome, Edge), no Android e no iOS: a fila vai para a TV e continua com o telemóvel bloqueado ou a app fechada; play, pausa, saltar, voltar, procurar e volume a partir da app.
- AirPlay no iOS e no Safari: a lista do sistema dentro da app.
- Desktop: TVs DLNA (Samsung, LG, Sony…) encontradas na rede.
- Receptor próprio do Chromecast com os visuais pronto em /cast/receiver (precisa do registo na consola do Google, docs/cast.md).

## 2.0.1 (2026-11-04)

- Tocar numa tab mostra sempre a raiz dela: no Android, com as Definições (ou um álbum, uma playlist…) abertas, tocar em Início não fazia nada. Tocar outra vez na tab aberta sobe a lista ao topo.

## 2.0.0 (2026-11-04)

O redesenho e o visualizador. O desktop salta da 1.4.1 para a 2.0.0, para ficar igual às outras.

- A versão aparece no fim das definições: "Versão 2.0.0 (build)".
- Redesenho: neutros do omelhorsite, Inter e Newsreader, todos os ecrãs no mesmo padrão, conteúdo a encher a janela no desktop.
- Visualizador como ecrã inteiro: 23 cenas que mudam com as secções da música, a letra e a capa em momentos, a Montagem.
- Leitor do telemóvel que abre sem esperar; letras pré-carregadas e palavra a palavra; Sincronizar/Gerar diz porquê quando não dá.
- Playlists sincronizadas (cópia fixa ou que acompanha a original); assistente com resposta em stream.
- Android: APK assinado fora da Play Store, com aviso de versão nova.
- iOS: TestFlight; a app da loja não importa de outros serviços.
- Desktop: assinado e notarizado pela Apple, actualiza-se sozinho.

## Antes da 2.0.0

- Mobile 1.1.0 e desktop de 1.0.0 a 1.4.1, cada um com o seu número. As tags `v1.x.y` são as releases do desktop.
