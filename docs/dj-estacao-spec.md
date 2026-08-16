# O Melhor DJ - modo estacao (spec do dono, 2026-08-16)

Referencia: DJ X do Spotify (screenshots do dono, desktop + mobile).
A voz ja existe (Kokoro af_heart, ingles, /speak no Mini) e o botao de
teste da barra desktop prova o circuito. Isto e o produto a serio.

## O flow (fiel ao Spotify)

1. **Entrada**: na Home, uma seccao propria ("O teu DJ pessoal") com um
   cartao-banner azul de largura inteira: badge Beta, o visual animado do
   DJ (arco/circulo verde), titulo grande ("Aqui e o teu DJ. As musicas
   que tu curtes") e seta de play. Na biblioteca/sidebar, um item fixo
   "O Melhor DJ - toca para comecar". Qualquer um comeca a sessao.
2. **Sessao**: o DJ apresenta-se a falar (a intervencao ocupa o lugar de
   "faixa" no player: titulo "A Seguir" / artista "O Melhor DJ", com um
   visual animado proprio em vez de artwork - circulo animado no Spotify),
   e depois poe musicas que ELE escolhe da biblioteca do utilizador.
3. **Entre musicas**: fala entre ALGUMAS (cadencia ~3-4 musicas), com
   contexto ("From your past", "Based on recent listening" - a razao da
   escolha aparece como subtitulo do bloco).
4. **Sem fila visivel**: "O DJ nao tem uma fila" - a proxima musica e
   segredo dele. O painel "A Seguir" mostra o visual do DJ.
5. **Botao DJ durante a sessao**: "Obtem escolhas do DJ diferentes" - um
   toque muda de direccao (novo batch + nova intervencao).
6. **Chat (mobile)**: "Your DJ X here. What can I play for you?" - campo de
   texto ("Escreve um pedido em Ingles"), chips de sugestao ("Let DJ pick",
   "Late-night hyperpop session with milkboy" - sugestoes geradas do gosto
   do utilizador) e mic. O pedido dirige o proximo batch.
7. Skips funcionam; sair da sessao devolve o player normal.

## Arquitectura

- **Backend (stateless)**: POST /music_dj/batch
  { request?: texto, recent_song_ids: [..], batch_index }
  -> { text, audio_base64, format, song_ids: [5-8], reason: "..." }
  Um so LLM call escolhe as musicas (catalogo do assistente, alfabetico,
  com sinais) E escreve o guiao; o Kokoro fala-o. O cliente gere a sessao:
  toca o clip, mete as musicas, e pede novo batch ao aproximar-se do fim
  ou quando o utilizador pede escolhas diferentes / manda um pedido.
- **FE**: modo "sessao DJ" no player (flag na store): fila alimentada por
  batches, "faixa" sintetica do DJ com visual animado enquanto fala,
  cartao de entrada na Home/biblioteca, chat sheet no mobile, botao de
  novas escolhas. Esconder a fila enquanto em sessao.
- Intervencao por cima do instrumental (stems) fica como refinamento
  posterior ao v1 do modo estacao.

## Licoes tecnicas do DJ X real (pesquisa 2026-08-16)

- **Cadencia**: fala a cada 3-4 musicas, a "introduzir o proximo set" -
  batch de ~4 musicas com UM clip por batch e o modelo certo.
- **Feedback vivo**: skips/likes/re-pedidos realimentam o perfil DURANTE a
  sessao (BaRT). Para nos: o pedido de batch leva recent_song_ids E
  skipped_song_ids, e o planner evita a direccao das skipped.
- **Sem gaps**: a voz e sintetizada ANTECIPADAMENTE e enfileirada em
  sincronia com a transicao planeada. O cliente pede o proximo batch
  quando faltam ~2 musicas do actual, para o clip estar pronto na
  fronteira (nunca esperar a rede com o utilizador em silencio).
- **Writers' Room**: no Spotify os factos do guiao sao verificados por
  editores, nunca alucinados. Para nos: o prompt PROIBE afirmacoes de
  facto fora do contexto fornecido (play counts, favoritas, datas da
  nossa BD); nada de biografias inventadas.
- **Porque funciona**: comentario ao lado da recomendacao faz o ouvinte
  dar hipotese a musicas que saltaria; 25% do tempo de escuta nos dias em
  que e usado.

Fontes: newsroom.spotify.com (2023-03-08 how-it-works; 2025-05-13
dj-voice-requests), medium.com/@ragyashraf (arquitectura), dynamoi.com,
gizmodo.com (review), variety.com (Sonantic/Xavier).
