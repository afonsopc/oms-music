# Ideias perdidas pelo caminho — inventário de 2026-08-16

Varrimento de todos os handoffs/backlogs/propostas contra o código real dos
dois repos, a pedido do dono ("verificasses por ideias perdidas"). Estado à
data; itens FEITOS omitidos de propósito (estão nos handoffs).

## Sem rasto nenhum (NADA)

Ideias com stems (a família mais valiosa — ninguém grande faz isto):
- **O Melhor DJ** (voz por cima do instrumental) — EM CURSO desde hoje: voz
  decidida (Kokoro af_heart, inglês only, local no Mini)
- **Mistura contínua com stems** — encadear instrumental da que sai com a voz
  da que entra (beatmatch a sério)
- **Karaoke / modo de treino** — tirar voz + letras sincronizadas + abrandar
  sem desafinar, numa vista só (as peças TODAS já existem soltas)
- **Loop de secção com detecção de compasso** — para quem aprende instrumento
- **Jam com stems repartidos** — cada pessoa da jam ouve uma mistura diferente

Social/planos:
- **Playlists semi-sincronizadas** (a minha segue a do Spotify + extras) — só
  desenho em docs/propostas/2026-08-17-playlists-derivadas.md
- **Partilha de playlists com amigos** (por referência, não cópia)
- **Sync do Spotify com UI decente** (o import continua "four tabs" da web)

Player/plataforma:
- **Mistura personalizada + EQ no desktop** — zero Web Audio no repo; a
  string `modeCustomUnavailable` continua nos catálogos
- **Vistas de playlist à Spotify** (capa centrada, dono com avatar, pills)
- **Badge de explícito** nas linhas de música
- **Página de artista: performance** (dois SongTable com scrollEnabled=false
  dentro do ScrollView montam TODAS as linhas)
- **Anterior/seguinte no lock screen Android** (OmsNativeModule continua
  no-ops)
- **Downloads que sobrevivem à morte do processo** (background-downloader)
- **Storage cap (FR-94)** — lê a quota mas não a aplica
- Colunas `source`/`listened_s` nos play_events (auditoria escrita, nunca
  aplicada)
- Chave i18n órfã `native.settings.hub.rowDownloads` (lixo, apagar)
- Cast / CarPlay / Android Auto / widgets / Watch (fora de v1, assumido)

## Parciais (o que falta em cada)

- **Arranque ~4s em música cacheada** — índice desktop gated ✓, sessão áudio ✓;
  FALTA: modos de stem furam a cache (`modes.ts` pede instrumental/vocal mas
  `status.ts` só conhece mixed → vai à rede "em cache")
- **Micro-skip de 3s pós-interrupção** — guarda + trace shipped; falta o dono
  confirmar no telefone (Definições > Reprodução > Diagnóstico)
- **Stats detalhadas** — Rewind feito; falta o ecrã por música/artista/álbum
- **Página de artista (desenho)** — margem corrigida; falta o redesenho
- **Druk Wide no desktop** — CSP corrigida; falta confirmação visual (e o
  wordmark entretanto saiu da Home, só vive no cartão final do Rewind)
- **Device picker** — aviso "precisa de um toque" ✓; fantasmas continuam
  listados como online
- **Overview de downloads** — só playlists; álbuns/artistas sem identidade
  persistida
- **Passkeys** — código completo, bloqueado pela conta Apple gratuita
- **Deep links verificados** — ficheiros .well-known existem; fingerprints
  por preencher

## Notas

- README.md:198 desactualizado (Google OAuth já não está escondido).
- Trabalho recente sem doc de origem (registar no próximo handoff):
  exportação de faixas/stems, sessões do assistente, geração de letras por
  IA + escada de alinhamento.
