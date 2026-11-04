# Redesenho e optimização da OMS Music (2026-11-04)

Pedido do dono: "ultra optimização e super melhoria de UI/UX… em tudo", o
mesmo tipo de passagem que se fez no omelhorsite.pt
(`omelhorsite/docs/plans/frontend-redesenho.md`). Telemóvel primeiro (90 % do
uso), preto e cinzentos neutros, capas grandes, ar editorial, sem "ar de IA"
(nada de cartões com gradiente, vidro, pílulas a mais), textos curtos em pt-PT
pré-AO90. Passos pequenos, cada um publicado.

## Antes (produção, 4/11/2026)

Web (music.omelhorsite.pt), Lighthouse 12 no telemóvel, 2 corridas:

| página | desempenho / acess. / boas práticas / SEO | LCP | FCP | TBT | peso |
|---|---|---|---|---|---|
| `/` → `/login` | 64-55 / 100 / 96 / 100 | 7,2-7,5 s | 1,3 s | 240-450 ms | 1,1 MB |
| `/home` (sem sessão) | 65 / 100 / 96 / 100 | 7,3 s | 1,3 s | 410 ms | 1,1 MB |

- JS: **um só ficheiro** (`entry-*.js`) de **3,98 MB** (1010 KB gzip, 775 KB
  brotli) em todas as páginas.
- Fonte Cantarell (112 KB) descarregada em todos os arranques, nunca usada.
- HTML vazio até o JS correr (ecrã preto ~6 s num telemóvel médio).
- O arranque espera por `GET /music/session` (e às vezes `GET /users/:id`)
  antes de desenhar o que quer que seja, mesmo com a biblioteca em cache.

Capturas: `docs/redesenho/antes/` (`*-390` telemóvel, `*-1400` computador),
todos os ecrãs com a conta do dono (só leitura, sessão de teste).

## O que a auditoria encontrou

Desempenho:
1. Sem divisão de código na web; Reanimated + gesture-handler + hammerjs
   (~1,2 MB de fonte) na web só para 7 animações simples e dois gestos.
2. Tocar play/pausa re-renderiza todas as linhas visíveis de uma lista
   (`SongTable` cria callbacks novos por linha e passa `isPlaying` a todas).
3. Nenhuma lista tem `getItemLayout` (as linhas têm altura fixa); a chave
   inclui o índice (reordenar remonta tudo).
4. As capas descarregam sempre no tamanho original, mesmo numa linha de 40 px.
5. O mini-leitor re-renderiza 4×/s (lê a posição inteira em vez de só a barra).
6. Fila do DJ e da jam em `ScrollView` + `map`.
7. Web sem pré-carregamento da música seguinte.

UI/UX:
1. Oito formas diferentes de cabeçalho (tamanhos 22-40, pesos 700-900) e três
   margens laterais (16, 20, 24); nenhum ecrã com largura máxima.
2. Pílulas por todo o lado (Tudo/Playlists/Álbuns/Artistas, filtros, chips
   das definições noutro estilo), cartões com gradiente no Início (DJ,
   Rewind, Assistente), faixa verde "A tocar em", Gostadas a roxo.
3. Spinners soltos em ecrã inteiro (playlists, coleções, letras, DJ, artistas,
   músicas, assistente…); sem estado de erro no Início, Pesquisa, Conta,
   Amigos, Rewind e DJ.
4. Sem hápticos (o `expo-haptics` está instalado e nunca é usado); só 2 sítios
   encolhem ao toque; nenhuma linha tem gestos.
5. Textos: AO90 em vários sítios (ação, selecionar, atualizar, desativada),
   "você" misturado com "tu", jargão (cache, stem, mixer, feed, bug).
6. Código morto: `lyrics/card.tsx`, componentes sem uso e 7 dependências que
   nada importa.

## Passos

### Passo 1 - velocidade sem mudar o aspecto

- Divisão por rotas na web (`asyncRoutes` do expo-router só em produção na
  web; o export estático põe no HTML de cada rota só os seus pedaços).
- Reanimated e gesture-handler fora da web: as animações simples passam para
  o kit comum `src/ui/motion.tsx` (Animated do RN: driver nativo no nativo,
  react-native-web na web); o player e o slider têm um par `.web.tsx` com
  pointer events (arrastar para fechar, Esc, setas no slider); a raiz dos
  gestos é `ui/GestureRoot` (uma View na web).
- Fora a Cantarell e o `lyrics/card.tsx` morto.
- Esqueleto em HTML/CSS no `+html.tsx` (`#boot`): barra, título e linhas a
  brilhar antes de qualquer JS, no tema escolhido (lido do localStorage antes
  de pintar); desvanece quando o primeiro ecrã monta.
- **Arranque optimista** (`auth/bootSnapshot.ts`): a sessão e a conta da
  última vez ficam guardadas; a app entra logo com elas (a biblioteca em cache
  pinta no primeiro frame) e o `GET /music/session` corre por trás (401 sai
  da conta como antes; sem rede fica a conta guardada).

Medido no mesmo Mac, export servido com gzip, Lighthouse 12 telemóvel:

| | antes | depois |
|---|---|---|
| JS de `/home` | 3,98 MB (1010 KB gzip) | 2,56 MB (708 KB gzip) |
| peso total | 1165 KB | 789 KB |
| desempenho | 64-65 | 76 |
| LCP | 7,5 s | 5,8 s |
| Speed Index | – | 2,1 s |
| TBT | 380-400 ms | 190-200 ms |

### Passo 1b - listas e toque

- `SongTable`: cada linha é um `TableRow` com memo que recebe as funções da
  tabela (estáveis) em vez de fechos novos por linha, e só a linha actual
  sabe se está a tocar: play/pausa/mudar de música redesenha 2 linhas em vez
  de todas as visíveis. `getItemLayout` (altura fixa), chave pelo id (o
  índice só entra quando a mesma música se repete), menos linhas montadas à
  partida (16 em vez de 40).
- Mini-leitor: só a barra fina ouve a posição (arredondada a 0,2 %); a
  pílula deixa de redesenhar 4×/s.
- Toque instantâneo: ao encostar o dedo numa música (`onPressIn`) o motor
  pede já o URL do áudio (`transport.warm`, no máximo 1 a cada 250 ms, nada
  a controlar outro aparelho); o play que vem a seguir encontra-o na cache.
- `build-web.sh`: os pedaços de JS das rotas dinâmicas (`[id]-<hash>.js`)
  eram apagados com os HTML de nome com `[` (v80 deixou playlist/artista/
  álbum em branco; v78 reposta em minutos, corrigido na v81). O build agora
  falha se algum `<script>` de um HTML não existir.
- Backend: o cookie da sessão da música passa a contar como credencial no
  tecto de pedidos (a web inteira estava no tecto anónimo de 120/min por IP).

## O padrão (passo 2)

Uma só forma de página em todos os ecrãs. Peças em `src/ui/page.tsx`,
`src/ui/motion.tsx`, `src/lib/haptics.ts`:

- **Cores**: só neutros (`theme/tokens.ts`): fundo `#0a0a0a`, superfícies
  `#111`/`#161616`/`#1a1a1a`, traços `#1f1f1f`, texto `#f5f5f5`, secundário
  `#a1a1a1` (claro: o inverso). Nada de laranja, roxo, verde ou gradientes
  coloridos na interface; as mixes e as Gostadas são carvão. A cor vem das
  capas.
- **Margem**: `useGutter()` (20 no telemóvel, 32 no computador). Nunca 16/24
  soltos.
- **Título**: `PageHeader` / `TabHeader` / `PageTitle` (30, 800, -0.8), uma
  linha, encolhe em vez de partir. Sem subtítulos a explicar a página.
- **Secções**: `SectionLabel` (20/700) com acção de texto opcional; nas
  definições o rótulo pequeno cinzento do `SettingsSection`.
- **Listas**: `ListRow` (56 px, sem caixa, traço fino, acende ao toque) ou
  `SettingsRow`. Nada de cartões dentro de cartões nem caixas com borda à
  volta de listas.
- **Filtros/secções**: `FilterPills` (agora palavras com um traço por baixo,
  acendem no toque). Nada de pílulas soltas, chips ou botões a mais.
- **Botões**: uma acção principal por ecrã (o `PlayFab` redondo nas
  coleções, `PrimaryButton` nos formulários); o resto `TextButton` (contorno
  fino) ou texto.
- **Estados**: `PageState` (esqueleto + `WaitHint` que muda de frase aos 2,
  6 e 20 s com "Tentar de novo"; erro "Não foi possível carregar." + "Tentar
  de novo"; vazio = ícone + uma frase + uma acção). Nunca um
  `ActivityIndicator` sozinho num ecrã; dentro de um botão a carregar, sim.
- **Movimento**: `Reveal order={i}` para entradas em cascata (rápidas,
  ≤ 0,4 s no total), `PressableScale` para o que se toca e não é uma linha,
  `useTween` para realces; tudo respeita "reduzir movimento".
- **Hápticos**: `haptics.select()` ao escolher, `haptics.tap()` ao tocar
  play, `haptics.press()` ao abrir um menu por pressão longa,
  `haptics.success()` ao gostar/guardar.
- **Optimista**: gostar, seguir, adicionar à playlist, apagar mudam no toque
  e desfazem se o servidor recusar.
- **Texto**: pt-PT pré-AO90 (acção, selecção, actualizar, óptimo, direcção),
  "tu" sempre, curto, sem jargão (nada de cache, stem, mixer, feed, bug,
  sync); chaves novas nos três catálogos.

## Depois (produção, v85, 4/11/2026)

Lighthouse 12 no telemóvel, produção, 2 corridas:

| | antes | depois |
|---|---|---|
| `/` → `/login`, desempenho | 55-64 | **71** |
| LCP | 7,2-7,5 s | **5,8 s** |
| Speed Index | – | 2,4-2,6 s |
| peso | 1106 KB | **765 KB** |
| acessibilidade / boas práticas / SEO | 100 / 96 / 100 | 100 / 96 / 100 |

Com sessão (a conta do dono, 1509 músicas), o mesmo Mac a servir o export
antigo (a4b2264) e o novo, telemóvel simulado (CPU 4×, 150 ms, 1,6 Mbps):

| | antes | depois |
|---|---|---|
| primeiro desenho | 6,5 s (ecrã preto) | **0,25 s** (esqueleto) |
| 6 capas visíveis, arranque frio | 7,3 s | **5,3 s** |
| JS da página | 3,98 MB num ficheiro | 2,56 MB em pedaços por rota |

Lighthouse de `/home` com sessão em produção: 65-68 (o LCP é uma capa
grande; 1,4 MB de imagens, das quais 386 KB são a foto da conta que o id
serve sem tamanho). O resto do tempo é o JS do react-native-web e do
expo-router, que já não dá para cortar sem sair do Expo.

Capturas: `docs/redesenho/depois/` (390 e 1400 de cada ecrã; o leitor, a
fila e as letras tiradas no servidor local com música a tocar, porque em
produção as capturas correm com o tempo real desligado para não mexer nos
aparelhos do dono), `docs/redesenho/comparar/*-390.webp` (antes | depois).

### O que mudou em cada ecrã

- **Início**: sem os cartões de gradiente; DJ, Rewind e Assistente são
  linhas; filas de capas grandes; erro e vazio.
- **Pesquisa**: um campo, resultados por secção, esqueletos, estados; só as
  4 primeiras fotos de artista pedidas à parte.
- **Biblioteca / Playlists / Artistas / Amigos / Perfil**: linhas sem caixas,
  "Sincronizada" só em texto, "+" no cabeçalho, esqueletos, foto grande do
  artista em destaque.
- **Playlist / álbum / Gostadas / mix / rádio**: capa quase do tamanho do
  ecrã, título grande à esquerda, uma fila de acções, "Mudar a capa" no "⋯".
- **Artista**: foto grande, "Populares", álbuns numa fila de capas.
- **Leitor, fila, letras**: capa maior, fundo mais escuro, hápticos em tudo;
  mini-leitor neutro com gestos no nativo; "A tocar em X" discreto.
- **Definições / conta / aparelhos / transferências / importar / login**:
  linhas, visto no tema e na língua, "Avançado", textos curtos pré-AO90,
  "Terminar sessão", lista de passos ao importar ficheiros.
- **DJ / Assistente / Rewind / Jam**: neutros; o Rewind com as capas
  desfocadas por trás e calado quando este aparelho comanda outro.
- **Página de importar** (oms-music-import): o mesmo padrão, com a lista de
  passos de cada importação.

### Fica para depois

- O simulador iOS deste Mac não tem a app Simulator (só o runtime): deu para
  arrancar a app e ver o login, não para entrar e tocar. A build do
  TestFlight é a verificação no telemóvel.
- O id serve a foto da conta em tamanho original (386 KB para 36 px).

## Ronda 2 (4/11/2026, tarde)

O que o dono pediu depois da v85: o computador "não está nada bem", sair do
ar de Spotify, um leitor do telemóvel que não seja lento, e cor sem ficar
berrante. Pelo caminho mudou de ideias duas vezes (estilo Apple Music, depois
"parecido com o omelhorsite"); fica a última:

- **Interface sóbria como o omelhorsite**: os neutros dele (`#0a0a0a`,
  `#111`, traços `#262626`; claro `#fafafa`), Inter servida por nós, botão de
  tocar branco, ícones cinzentos e o activo a branco, nenhuma cor nos
  controlos. A cor vem só das capas e da camada visual.
- **Letras**: a web caía na pilha de sistema do react-native-web (Arial/
  Liberation no Linux e no Windows). Agora Inter em woff2 (latin e latin-ext),
  `font-display: swap`, só o latin em preload, e um remendo ao
  react-native-web (`patches/`) que põe a `OMS Sans` à cabeça da pilha. Medido
  pelo protocolo do Chrome (letra que cada texto usa de facto): num Chromium
  em Linux real (Docker no Mini) 100 % Inter.
- **Computador**: um só fundo com traços finos (sem cartões nem folgas), o
  conteúdo enche a zona principal toda (a caixa centrada de 1440 deixava
  bandas vazias com zoom), barra lateral com a lista da biblioteca em letra
  maior, pesquisa em cima, painel da direita fechado por omissão, barra do
  leitor maior. Verificado a 1280, 1440, 1920 e 2560, com e sem painel.
- **Mixes**: mosaico de imagem inteira com o nome por cima; sem imagem, uma
  capa gerada em carvão.

### Leitor do telemóvel

Abrir era navegar para um ecrã modal (montava o leitor inteiro antes do
primeiro frame; fechar arrastava e só depois navegava). Agora é uma folha
montada uma vez (`src/features/player/sheet/`): no nativo o dedo escreve no
progresso (Reanimated) na thread da UI, no mini-leitor para cima e na
pega/capa para baixo, e a mola acaba com a velocidade do dedo; na web o
ponteiro mexe no `transform` sem estado React e uma transição CSS acaba. O
corpo é `memo`, a barra de progresso só ouve a posição com a folha aberta,
play/pausa muda no toque (`optimisticPlay`), o slider tem 44 px de toque e
engrossa a arrastar, a capa encolhe na pausa, o fundo é a cor da capa.

Medido na web do telemóvel (390 px, toque, CPU 4x mais lenta,
`/tmp/omsm-r2/tools/measure.mjs`):

| | antes (v89) | depois (v91) |
|---|---|---|
| abrir: do toque ao primeiro movimento | 343 ms na 1.a vez, depois um corte seco sem animação | 46 ms, desliza 300 ms |
| abrir: frames perdidos | 1 | 0 |
| fechar: do dedo à reacção / frames perdidos | 54 ms / 0 | 38 ms / 0 |
| play/pausa, seguinte | 30-50 ms | 30-60 ms (o ícone muda no toque) |

No iPhone não deu para medir aqui (este Mac não tem a app Simulator): a
arquitectura é a que tira o trabalho da thread de JS durante o gesto, e o
teste é o TestFlight.

### A camada que reage à música

- **Análise no backend** (oms-music-backend `Music::AudioAnalysis`): um ffmpeg
  com `nice` mede o RMS em 5 faixas a 50 blocos/s; ataques, BPM e grelha das
  batidas; guarda energia e 4 faixas a 25/s (30-60 KB por música) em
  `song_analyses`. `GET /songs/:id/analysis` (202 enquanto faz, pedido único).
  1-2 s por música no Mini, uma de cada vez; a varredura faz 12 músicas de 10
  em 10 minutos (primeiro as tocadas nos últimos 90 dias), as 11 681 em ~5 dias.
- **Motor `/viz/`** (`viz/`, 30 KB, sem dependências): um iframe na web e no
  computador, um WebView no iOS/Android. Sem FFT ao vivo na web: o `<audio>`
  não é carregado com `crossOrigin` e um `AnalyserNode` assim calava a música;
  fica a análise pré-calculada em todo o lado.
- **Onde aparece**: o fundo do leitor (aurora viva, só depois da primeira
  abertura, em pausa escondido), o visualizador em ecrã inteiro
  (`/visualizer`: 11 cenas, deslizar ou setas, muda a cada 16 compassos, modo
  caos, CRT, cores partidas, píxeis, pontilhado), o mini-leitor a brilhar nas
  batidas, a forma de onda nas barras de progresso e a marca "OMS Música" em
  OMS Wide a girar na barra lateral (o truque do antigo nome do omelhorsite).
- **Frames** (Chromium deste Mac, 1280x720, depois de aquecer): 60 fps em
  todas as cenas, 0 frames perdidos por janela de 2 s; o título 3D, a mais
  pesada (24 camadas de DOM), 57 fps.

Capturas: `docs/redesenho/ronda2/antes/`, `ronda2/depois/` (produção v94) e
`ronda2/visuais/` (cada cena). Vídeos (fora do repo, 14 MB):
`~/Documents/oms/builds/oms-music-ronda2/videos/`.

### Fica para depois

- Inclinação da capa pelo giroscópio no telemóvel: precisa de um módulo
  nativo novo (`expo-sensors`); no computador não foi feito.
- Medir os frames no iPhone (o motor manda-os à app; falta mostrá-los).
