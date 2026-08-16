# Desenho 3.6: playlists semi-sincronizadas e partilha com amigos

Escrito pela sessão cloud de 2026-08-17/18, com o sync real lido
(`spotify_playlist_sync_job.rb`). O backlog pede o modelo ANTES do código;
isto é o modelo. Nada disto está implementado.

## Factos do sync actual que o desenho tem de respeitar

1. O sync só CRIA e REORDENA `playlist_songs`; nunca apaga rows
   individuais (só playlists inteiras des-seleccionadas nas settings).
2. Playlists `spotify_sync` estão fechadas a edições server-side; o
   utilizador hoje só pode "criar cópia editável" (que perde o sync).
3. O atalho de snapshot_id salta playlists não alteradas no modo auto -
   qualquer desenho novo não pode partir isso.

## A. Semi-sync ("a minha playlist SEGUE a do Spotify e tem extras")

Não é preciso um modelo "playlist derivada" novo: chegam DUAS colunas em
`playlist_songs`, porque a playlist sincronizada já É a derivação de uma
origem - só lhe falta distinguir o que é da origem do que é meu.

```ruby
add_column :playlist_songs, :origin, :string, null: false, default: "sync"
  # "sync"  - row criada/gerida pelo sync; posições reescritas por ele
  # "local" - row acrescentada pelo utilizador; o sync NUNCA lhe toca
add_column :playlist_songs, :hidden, :boolean, null: false, default: false
  # remoção local de uma música da origem: a row fica, marcada hidden.
  # O sync vê a row existir e não a re-cria; o render salta-a.
```

Regras:
- Em playlists `manual`, todas as rows nascem `origin: "local"` (default
  da migração aplica-se só a rows novas de playlists spotify_sync; um
  backfill marca as existentes conforme o source_kind da playlist).
- O endpoint de add/remove passa a aceitar playlists spotify_sync:
  add cria `origin: "local"` com posição > 100_000 (as locais vivem SEMPRE
  depois das da origem, que é o que "herda e acrescenta" significa);
  remove numa row "sync" faz `hidden: true`; remove numa row "local"
  destrói. Reordenar só é permitido dentro do bloco local.
- O sync continua exactamente igual com uma excepção: ao reescrever
  posições, `where(origin: "sync")`. As locais nunca são tocadas e o
  snapshot shortcut continua válido.
- O render (blueprint) exclui `hidden` e devolve `origin` por row, para a
  UI poder mostrar o separador "As tuas adições".

Custo: 1 migração + backfill, ~6 guardas de autorização relaxadas, 1
where no sync, UI de secção na playlist. Sem tabelas novas, sem cópias.

## B. Partilha com amigos ("as playlists dos amigos na minha biblioteca")

A recomendação do backlog está certa e o modelo é uma REFERÊNCIA:

```ruby
create_table :playlist_follows do |t|
  t.string :user_id, null: false        # quem segue
  t.bigint :playlist_id, null: false    # a playlist DO OUTRO
  t.timestamps
end
add_index :playlist_follows, [:user_id, :playlist_id], unique: true
add_column :playlists, :visibility, :string, null: false, default: "private"
  # "private" | "friends" - o dono decide por playlist
```

Autorização: `playlist.visible_to?(user)` = dono, ou (`visibility ==
"friends"` e existe Relationship aceite entre os dois). O follow só se
cria se visible_to?; se a amizade acabar ou a visibilidade fechar, o GET
devolve 403 e a UI mostra "já não tens acesso" (a row de follow pode ficar,
é inofensiva).

Resolução por faixa - a parte que o dono desconfiava, e a regra é: **nunca
copiar bytes nem rows**. `GET /playlist_follows/:id/resolved` devolve, por
row da playlist do amigo:

```
{ position, title, artists, album, duration,
  match: { song_id } | null }
```

com `match` calculado contra a biblioteca de QUEM PEDE, nesta ordem:
1. `isrc` igual (é o dedupe que os merges já usam);
2. (artista canónico, título normalizado pelo DuplicateFinder.normalize_title);
3. sem match -> null, e a UI mostra a row com estado "não tens esta"
   (cinzenta, sem play; menu com "Importar" a apontar ao fluxo de import
   normal, se o dono quiser essa ponte).

O resolvedor é uma query por lote (carregar isrc+canónicos da biblioteca
do requerente uma vez, resolver em memória), nunca N queries.

No cliente, a playlist seguida aparece na biblioteca com o avatar do dono
como badge; o ecrã é o CollectionScreen normal com as rows não-resolvidas
desactivadas. Offline: as resolvidas com download tocam; as outras não -
sem estado especial novo.

## Ordem de implementação sugerida

1. A (semi-sync) primeiro: não depende de amizades e destrava o pedido
   mais concreto do dono ("o sync come as minhas adições").
2. B depois, começando por visibility+follows+endpoint resolvido, UI no
   fim. Cada passo é útil sozinho.
