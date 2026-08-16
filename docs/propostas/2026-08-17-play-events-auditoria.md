# Bug 2.4 (estatísticas mentem): o que se confirmou e o que se propõe

Escrito pela sessão cloud de 2026-08-17, com os DOIS emissores e o backend
lidos linha a linha (omelhorsite clonado em leitura).

## O que está CERTO hoje (verificado)

- **oms-music**: `ListenAccumulator` (`src/player/recording.ts`) só regista
  depois de min(30 s, duração/2) de escuta REAL - deltas só para a frente e
  < 2 s; seeks e trocas de source não contam; jam não conta; transferências
  chegam pré-marcadas. Testado em `recording.test.ts`.
- **frontend /music do omelhorsite**: critério idêntico (MusicProvider.tsx,
  mesmo min(30, dur/2) com os mesmos deltas).
- **backend**: o `ok!` do dedupe LEVANTA excepção (ResponseHelpers::HttpExit),
  portanto o dedupe de 30 s funciona; as agregações do `PlayEventsQuery`
  contam linhas por song_id sem truques. O perfil mostra os últimos 30 dias.

Ou seja: **não há bug de medição no código actual.** As explicações que
sobram para "brainrot rap pt. 1" no topo:

1. **Herança de merges por ISRC.** `songs:dedup_by_isrc` e
   `songs:dedup_cross_source` re-apontam PlayEvents das músicas perdedoras
   para a keeper. Se algum merge juntou gravações diferentes (ISRC errado da
   tag do upload, ou o download errado do bug 2.5 a carregar o ISRC do
   Spotify), os plays de várias músicas empilharam-se numa.
2. **Loops legítimos.** Loop One/All conta um play por volta (padrão da
   indústria); uma música de 2 min em loop numa noite são ~200 plays reais
   aos olhos do critério.
3. **História anterior ao critério** (repo squashed a 2026-08-11) - mas o
   perfil é a 30 dias, portanto isto já envelheceu para fora, a não ser que
   os merges tenham arrastado linhas antigas para músicas novas.

## Auditoria proposta (uma consola Rails em produção)

```ruby
song = Song.viewable_by(user).where("title ILIKE ?", "%brainrot rap%").first
events = PlayEvent.where(song: song).order(:played_at)
events.group_by { |e| e.played_at.to_date }.transform_values(&:size)
# gaps entre eventos consecutivos: um tapete de ~duração_da_faixa = loop;
# rajadas coladas ao created_at de um merge = herança de merge
events.each_cons(2).map { |a, b| (b.played_at - a.played_at).round }.tally
       .sort_by(&:last).reverse.first(10)
```

## Endurecimento proposto (para o Rewind/estatísticas do 3.7 nascerem honestos)

1. `play_events.source` (string curta: `oms-ios`, `oms-desktop`, `web`) -
   os dois emissores passam-na no POST; o backend guarda. Custa uma migração
   e duas linhas por cliente, e torna todas as auditorias futuras triviais.
2. `play_events.listened_s` (float, opcional) - o acumulador já sabe quanto
   se ouviu; guardar permite estatísticas por tempo de escuta (o que o
   Spotify Wrapped usa) em vez de contagens.
3. O 3.7 (Rewind) deve filtrar `source` e, se a auditoria confirmar herança
   de merges, aceitar um corte por data ("plays contados desde X").
