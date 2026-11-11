# OMS Music: versões

Uma versão para a app inteira: iOS, Android, web e desktop levam o mesmo número.
Sobe-se com `bun run version:bump patch|minor|major` (docs/DEVELOPMENT.md, "Versões").
O que entra vai para "Por lançar"; o bump dá-lhe o número.

## Por lançar

- Fotos dos artistas: passam a vir só do armazenamento da OMS Music (as que já tinhas foram copiadas para lá), nunca de outros sites. Na edição do artista, a galeria só se pode encurtar: já não se cola o endereço de uma imagem de fora.
- Letras e fotos dos artistas: a app deixa de as ir buscar a outros serviços. Mostra as que estão na tua biblioteca; as que faltam procuram-se na página de importar (sozinhas ao importar uma música, ou na aba "Letras e imagens", todas de uma vez ou uma a uma). As letras e fotos que já tinhas ficam.
- Downloads de playlists, álbuns e artistas: cada música mostra o seu estado: um relógio enquanto espera, um anel que se vai enchendo enquanto descarrega, um visto quando está no aparelho e um aviso se falhar. Ao lado do botão de download aparece "12 de 40" até estarem todas. No iPhone, as músicas que já tinham sido pré-carregadas (normalmente as que estão no ecrã) eram saltadas pelo download da playlist: não mostravam estado nenhum e não ficavam guardadas para ouvir sem rede. Agora ficam.

## 2.1.3 (2026-11-07)

- Letras: numa música já cantada na língua da tradução (ex. uma música portuguesa com o PT ligado) deixa de aparecer por baixo de cada linha uma cópia quase igual, só com vírgulas ou "?" a mais. Não há tradução para a mesma língua, e uma linha traduzida que só muda pontuação, maiúsculas ou acentos não aparece.
- Letras: o botão "Voltar à linha actual" só aparece quando a linha que está a tocar saiu do ecrã.
- Visualizador "Painel de partidas": deixa de travar o telemóvel (no iPhone corria a ~10 fps com o processador a 100 %); agora a 60 fps com ~15 %, com o mesmo aspecto. Os visuais param com a app em fundo.

## 2.1.2 (2026-11-05)

- iPhone: a app fechava sozinha ao abrir o Transmitir com uma TV na rede, e depois em todos os arranques. O número de build (202611050730) era grande de mais para o Google Cast, que abortava a app; passa a ser 261105.812 (data e hora curtas) e o build recusa números que o Cast não aceita. O Cast também deixa de procurar TVs no arranque: só quando abres o Transmitir.

## 2.1.1 (2026-11-05)

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
