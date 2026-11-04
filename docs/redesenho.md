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

### Passo 1 — velocidade sem mudar o aspecto

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

### Passo 1b — listas e toque

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
