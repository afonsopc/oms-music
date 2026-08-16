# Handoff para a sessão cloud - backlog de funcionalidades e bugs

Escrito a 2026-08-17 para uma sessão que corre em **Linux, sem dispositivos**.
Português europeu, sem em-dashes, como o resto do repo.

Lê primeiro, por esta ordem: `AGENTS.md`, `docs/handoff-2026-08-16.md`
(sessão anterior e armadilhas) e `docs/handoff-2026-08-17.md` (a noite que
fechou 12 dos 19 pontos e deixou 4 abertos com evidência).

---

## 0. O que esta máquina NÃO tem

Isto não é uma limitação a contornar; é o desenho do trabalho.

| Não há | Consequência prática |
| --- | --- |
| iPhone / macOS / simulador | Nada de `xcodebuild`, `devicectl`, nem builds Tauri de macOS. Não escrevas "testado" sobre o que não correste. |
| Safari e qualquer browser real | Não há prova visual. `bash scripts/build-web.sh` prova que o export CONSTRÓI, não que a UI está bem. |
| `osnosite` CLI e credenciais | **Não publicas.** Nem staging, nem produção. Fazes commit e push; o dono publica. |
| Acesso ao repo `omelhorsite` | O backend Rails não está aqui. Onde for preciso mexer no servidor, escreve o patch proposto num ficheiro `docs/propostas/` em vez de o inventar às cegas. |

O que TENS, e que é a tua rede de segurança: `bun run typecheck`,
`bun run lint` (0 erros e 0 avisos, sem excepções), `bun test`, e
`bash scripts/build-web.sh`. Corre os quatro antes de cada commit que mexa em
rotas ou no shell; os três primeiros sempre.

Regras do repo que valem mais do que a tua preferência: trabalha em `master`
directamente (sem branches por feature - está no `AGENTS.md`); comentários e
strings em português europeu; comenta o PORQUÊ; **não corras prettier** (o repo
não tem config e escreve a ~100 colunas); zero dependências novas sem uma razão
escrita; strings visíveis sempre por i18n nos três catálogos
(`src/i18n/catalogs/{pt,en,lv}.json`).

---

## 1. Estado à partida

`master` em `08fb75d`, tudo empurrado, gates verdes, 841 testes. As três apps
foram construídas e instaladas pelo dono a partir deste commit; a web está em
staging com o pedido de produção #90 por aprovar.

Aberto da lista anterior (detalhe em `docs/handoff-2026-08-17.md` secções 3 e
4): o arranque de ~4 s numa música em cache (causa confirmada no desktop, por
medir no nativo), a mistura personalizada indisponível no desktop, as vistas de
playlist à Spotify, e o redesenho da página de artista.

---

## 2. Bugs novos (o dono, 2026-08-17)

### 2.1 Mini-player do desktop mostra "Unmatched Route"

Sintoma: a janela abre com "Unmatched Route - Page could not be found", não se
fecha nem se move.

**Os dois sintomas têm uma só causa e vale a pena começar por aqui.** O
`RootLayout` (`src/app/_layout.tsx`) devolve `<MiniplayerApp />` mais cedo
quando `isMiniplayerWindow()` é verdade, e essa função lê
`location.search === "?miniplayer=1"` (`src/desktop/miniplayer.ts`). Se o
utilizador vê a rota não-encontrada, então esse `if` NÃO disparou: o expo-router
seguiu para o navegador e não achou rota para `/index.html`. Logo a janela
também não tem `data-tauri-drag-region` (vive no `MiniplayerApp`) nem botão de
fechar, e como a janela é criada com `decorations(false)`
(`desktop/src-tauri/src/miniplayer.rs`) fica sem barra de título: prisão
perfeita.

Suspeito principal: a reestruturação de rotas para tabs nativas mudou o que o
export estático serve na raiz, ou o protocolo do Tauri entrega o `index.html`
sem preservar a query string. Verifica o que `location.href` é mesmo dentro
daquela janela antes de mexer em código.

Independentemente da causa, **a janela precisa de uma saída própria**: um botão
de fechar na UI e/ou `decorations(true)` enquanto isto não estiver resolvido.
Uma janela sem porta é pior do que uma janela feia.

### 2.2 "OMS Music" não fica em Druk Wide no desktop

O wordmark novo do cabeçalho da Home (`src/features/home/index.tsx`) usa
`FONT_DRUK_WIDE` de `src/theme/typography.ts`, carregado por
`Font.loadAsync` com um `require` do `.otf`. No telemóvel funciona. Duas
hipóteses para a web/Tauri, por esta ordem: a CSP da janela
(`desktop/src-tauri/tauri.conf.json`, `font-src 'self' data:`) recusar o
ficheiro servido pelo protocolo do shell, ou o `fontFamily` do
react-native-web não bater com o nome que o `@font-face` recebe. Confirma qual
antes de escolher a correcção.

### 2.3 Página de artista sem foto, a mostrar a capa do álbum

Artistas que já tiveram boas imagens do Deezer aparecem agora com a capa do
álbum. Isto cheira a regressão do backfill de imagens ou a uma resolução que
degrada cedo demais. O caminho começa em `src/domain/artwork.ts`
(`artistImageSource`) e acaba no backend. Se a causa for do lado do servidor,
escreve a proposta em `docs/propostas/`, não adivinhes.

### 2.4 Estatísticas de reprodução mentem

O dono vê "brainrot rap pt. 1" no topo de músicas mais ouvidas quando quase
nunca a toca. Revê quem regista plays e com que critério: um evento por
`setQueue`? por seek? por retoma? Um play só devia contar depois de uma fatia
real de escuta (o padrão da indústria anda nos 30 s ou 50% da faixa). Procura
por `playEvents` em `src/api/queries/` e pelo emissor no motor. Escreve testes
com as regras que decidires.

### 2.5 "Part Of Me" da Katy Perry no perfil não é a música certa

Sintoma de um problema mais fundo no matcher/sync de músicas. Investiga e
descreve; a correcção pode ser de dados (backend) e nesse caso vai para
`docs/propostas/`.

### 2.6 A tab "Tudo" da Home às vezes abre vazia

Provavelmente uma corrida entre queries e o filtro (`HomeFilter`), ou secções
que colapsam em silêncio quando a query ainda não resolveu. Reproduz-se por
teste se conseguires isolar a condição.

### 2.7 Limpezas pedidas

- Tirar "Pesquisar" da sidebar do desktop/web desktop (só põe foco no campo).
  O ponto 18 da lista anterior já mexeu nisto; confirma o que ficou e remove o
  item de vez se ainda lá estiver.
- Tirar o ícone da barra de menus do macOS (`desktop/src-tauri/src/tray.rs`) -
  o dono diz que não serve para nada. Podes editar o Rust; não consegues
  construir para confirmar.

---

## 3. Funcionalidades pedidas

Ordenadas por relação valor/risco, não pela ordem em que foram ditas. As três
primeiras são as que mais melhoram o uso diário com menos superfície nova.

### 3.1 Downloads com granularidade (alto valor, risco baixo)

Hoje há transferências, mas a UI não deixa escolher o alvo. Deve dar para
descarregar **um artista inteiro, um álbum, uma playlist ou uma música**. A
camada local-first já existe (`src/downloads/**`, `src/prefetch/**`, e o lado
Rust em `desktop/src-tauri/src/cache/`); o que falta é a UI e o
enfileiramento por colecção. Pensa no que acontece quando uma música pertence a
duas colecções descarregadas (contagem de referências, não duplicação de
bytes).

### 3.2 Atalhos de teclado

Portar os do `/music` do frontend do omelhorsite: seta esquerda/direita,
barra de espaço, seta cima/baixo. Vale para a web e para o shell desktop.
Cuidado com o foco: não roubar a barra de espaço a um campo de texto.

### 3.3 Bottom bar do desktop clicável

Na barra de transporte, o nome da música e a artwork abrem o álbum com a
música seleccionada; o nome do artista abre a página do artista. Já existe
`songAlbumRoute`/`songArtistRoute` em `src/lib/routes.ts`.

### 3.4 Mixes: mais, mais frequentes e mais variados

Hoje são por artista. O dono quer também "O Teu Agosto", "Mix Laura Les",
"Mix 2025". Além disso: no cartão do mix, o nome do artista na descrição deve
ser clicável e abrir o perfil dele. E **deve dar para guardar um mix como
playlist** na biblioteca. A geração vive no backend - proposta escrita, não
invenção.

### 3.5 Sync do Spotify com UI/UX decente

O que existe funciona mas mostra-se mal. Além disso o dono quer:
- botões na página do artista para activar o **sync diário** desse artista;
- **playlists semi-sincronizadas**: uma playlist minha que SEGUE uma do
  Spotify e acrescenta extras (ou seja, herda as músicas da origem e tem as
  suas próprias por cima, sem que a próxima sincronização as coma).

Esse segundo ponto é modelação a sério: pensa em "playlist derivada" com uma
origem e um conjunto de adições/remoções locais, e escreve o modelo antes do
código.

### 3.6 Partilha de playlists com amigos

As playlists dos amigos apareceriam na biblioteca. O dono já desconfia da
parte difícil e tem razão: as músicas são de bibliotecas diferentes. **A minha
recomendação é não copiar bytes nem linhas**: a playlist partilhada é uma
referência à do outro utilizador, e cada faixa resolve-se contra a MINHA
biblioteca; o que eu não tiver aparece com um estado próprio ("não tens esta")
em vez de desaparecer ou de ser importado às escondidas. Se não conseguires
desenhar isto sem tocar em permissões do backend, escreve a proposta e passa à
frente - é melhor não ter do que ter meio.

### 3.7 Estatísticas e Rewind anual

Estatísticas mais detalhadas por música/artista/álbum, e um "rewind" anual.
**Depende do 2.4**: não construas nada em cima de uma contagem de plays que
sabemos estar errada. Corrige primeiro a medição, depois constrói a vitrina.

### 3.8 "O Melhor Assistente" (chat de IA)

Chat que cria playlists e responde sobre os hábitos de escuta. Segue **o mesmo
estilo da biblioteca de livros do omelhorsite**: OpenRouter com modelos
gratuitos, cliente mínimo, sem gems de LLM. A referência está em
`backend/app/services/openrouter/client.rb` do repo omelhorsite - um POST a
`/chat/completions`, lista de modelos por ordem de fallback
(`xiaomi/mimo-v2-flash`, `meta-llama/llama-3.3-70b-instruct`,
`qwen/qwen3-vl-32b-instruct`), `response_format: json_object` quando se quer
JSON, chave em `Rails.application.credentials.dig(:openrouter, :api_key)`.

Regra de ouro para esta feature: o modelo **propõe**, o servidor **valida**. Um
LLM nunca escreve directamente na biblioteca; devolve JSON com ids que o
backend confirma existirem e pertencerem ao utilizador.

### 3.9 "O Melhor DJ" (DJ de IA com voz)

Como o DJ X: comentários falados entre faixas. Mesmo stack de LLM para o
guião; a voz precisa de TTS, e essa decisão (serviço, custo, latência,
offline) tem de ser escrita e mostrada ao dono antes de se escolher. Nota que
a app já tem separação de vozes e alteração de velocidade com pitch, portanto
há aqui matéria para algo mais original do que ler um guião por cima do
silêncio: um DJ que fala POR CIMA do instrumental da faixa a sair, usando os
stems que já sabemos produzir, seria uma coisa que nenhuma app grande faz.

### 3.10 Ideias novas (o dono pediu explicitamente que se pensasse nisto)

A app já tem duas coisas raras: separação vozes/instrumental e velocidade com
alteração de pitch. Direcções que continuam essa linha, em vez de copiar o
Spotify:

- **Mistura contínua com os stems**: encadear faixas alinhando o instrumental
  da que sai com a voz da que entra. É DJ a sério, e só é possível porque já
  separamos.
- **Karaoke / modo de treino**: tirar a voz, mostrar as letras sincronizadas
  que já temos, e opcionalmente abrandar sem desafinar. Tudo isto já existe em
  peças soltas; falta juntá-las numa vista.
- **Loop de secção com detecção de compasso**: escolher um trecho e repeti-lo
  em ciclo, para quem aprende um instrumento.
- **Jam com stems repartidos**: numa jam, cada pessoa ouve uma mistura
  diferente (um só a voz, outro só a bateria). Absurdo e memorável.
- **Modo adormecer**: baixar o pitch e a velocidade progressivamente ao longo
  do temporizador, em vez de cortar o som a meio de uma faixa.

Escolhe UMA e leva-a até ao fim; cinco meias-features valem menos do que uma
inteira.

---

## 4. Como quero que trabalhes

- Um tema por commit, com mensagem que explique o PORQUÊ (vê o histórico
  recente: as mensagens contam a causa, não a lista de ficheiros).
- Testes onde a lógica for pura. Se escreveres um teste de regressão, verifica
  que ele FALHA contra o código antigo antes de o dares por bom.
- Quando não conseguires provar uma correcção nesta máquina, di-lo no commit e
  no handoff que deixares. É preferível a fingir.
- O que for especulativo ou grande demais para rever de uma vez vai para um
  branch próprio, implementado, e fica à espera do dono (é a única excepção à
  regra de não haver branches).
- No fim, escreve `docs/handoff-<data>.md` no mesmo formato dos anteriores:
  estado, o que ficou fechado, o que ficou aberto COM evidência, e o que
  encontraste pelo caminho e não corrigiste.
