# Feature 3.5a: sync diário por artista (backend completo, TESTADO)

Escrito pela sessão cloud de 2026-08-17/18. Não é uma proposta em prosa: é
a implementação inteira, com a suite Rails a passar nesta máquina
(5 testes novos verdes, 28/28 em test/jobs, rubocop limpo). Aplica com
`git apply` e corre `rails db:migrate`.

## O desenho, em três frases

Seguir um artista cria um `ArtistSync` (user, spotify_artist_id) com um
**snapshot dos ids de álbum do catálogo actual** - seguir significa
lançamentos NOVOS a partir daí, nunca a discografia outra vez. Um job
diário (5:00, com a mesma janela anti-estampido do sync de playlists)
compara o catálogo actual com o snapshot e, havendo álbuns novos, cria um
`ArtistImport` **só com eles** - o pipeline existente (progresso na UI,
dedupe por ISRC, matcher) faz todo o resto. O snapshot guarda a UNIÃO dos
ids: um álbum que o Spotify esconda e volte a mostrar nunca re-importa.

## API

- `GET /artist_syncs` - `{items: [{id, spotify_artist_id, artist_name, enabled, last_checked_at, known_album_count}]}`
- `POST /artist_syncs` `{spotify_artist_id, spotify_artist_name}` - liga
  (idempotente; re-ligar não refaz o snapshot)
- `DELETE /artist_syncs/:id` - desliga

## O que falta do lado do oms-music (próxima sessão)

O botão na página do artista: mapear o artista da biblioteca para o
spotify_artist_id via `GET /artist_imports/search?q=<nome>` (o roster do
resultado já traz o id) e chamar o POST/DELETE acima. O estado "a seguir"
lê-se do GET. Sem Spotify ligado o backend responde 400 "Connect Spotify
first." - esconder o botão quando `GET /spotify_syncs/status` disser que
não há ligação.

## Diff (git apply no repo omelhorsite; correr db:migrate depois)

```diff
diff --git a/backend/app/controllers/artist_syncs_controller.rb b/backend/app/controllers/artist_syncs_controller.rb
new file mode 100644
index 0000000..bf78612
--- /dev/null
+++ b/backend/app/controllers/artist_syncs_controller.rb
@@ -0,0 +1,59 @@
+class ArtistSyncsController < ApplicationController
+  # GET /artist_syncs - os artistas que o utilizador segue (sync diário).
+  def index
+    items = ArtistSync.viewable_by(Current.user).order(created_at: :desc)
+    ok!({ items: items.map { |s| serialize(s) } })
+  end
+
+  # POST /artist_syncs
+  # body: { spotify_artist_id: "...", spotify_artist_name: "..." }
+  # Liga o sync e tira o snapshot do catálogo ACTUAL: seguir significa
+  # lançamentos novos a partir de agora; a discografia existente importa-se
+  # pelo fluxo de importação normal, se e quando o utilizador quiser.
+  def create
+    spotify_artist_id = params.require(:spotify_artist_id).to_s
+    return bad_request!("Connect Spotify first.") unless spotify_identity
+
+    sync = ArtistSync.find_or_initialize_by(user: Current.user, spotify_artist_id: spotify_artist_id)
+    sync.artist_name = params[:spotify_artist_name].to_s.presence || sync.artist_name
+    sync.enabled = true
+    if sync.known_album_ids.blank?
+      client = SpotifyClient.new(spotify_identity)
+      sync.known_album_ids = client.each_artist_album(spotify_artist_id).map { |a| a["id"] }.compact.uniq
+    end
+    sync.last_checked_at = Time.current
+    sync.save!
+    created!(serialize(sync))
+  rescue SpotifyClient::TokenRefreshFailed
+    bad_request!("Spotify connection needs to be relinked.")
+  rescue SpotifyClient::UpstreamError => e
+    bad_request!("Spotify upstream error: #{e.message[0, 200]}")
+  rescue ActionController::ParameterMissing => e
+    bad_request!(e.message)
+  end
+
+  # DELETE /artist_syncs/:id
+  def destroy
+    sync = ArtistSync.viewable_by(Current.user).find_by(id: params[:id])
+    not_found!("Artist sync not found") if sync.nil?
+    sync.destroy!
+    ok!({ ok: true })
+  end
+
+  private
+
+    def spotify_identity
+      @spotify_identity ||= Current.user.identities.find_by(provider: "spotify")
+    end
+
+    def serialize(sync)
+      {
+        id: sync.id,
+        spotify_artist_id: sync.spotify_artist_id,
+        artist_name: sync.artist_name,
+        enabled: sync.enabled,
+        last_checked_at: sync.last_checked_at,
+        known_album_count: Array(sync.known_album_ids).size
+      }
+    end
+end
diff --git a/backend/app/jobs/artist_daily_sync_dispatcher_job.rb b/backend/app/jobs/artist_daily_sync_dispatcher_job.rb
new file mode 100644
index 0000000..9e86487
--- /dev/null
+++ b/backend/app/jobs/artist_daily_sync_dispatcher_job.rb
@@ -0,0 +1,14 @@
+class ArtistDailySyncDispatcherJob < ApplicationJob
+  queue_as :default
+
+  # A mesma disciplina anti-estampido do SpotifyDailySyncDispatcherJob: cada
+  # verificação espalha-se por uma janela para não martelar o rate limit.
+  STAMPEDE_WINDOW_S = 30.minutes.to_i
+
+  def perform
+    ArtistSync.due.find_each do |sync|
+      offset = rand(STAMPEDE_WINDOW_S)
+      ArtistSyncCheckJob.set(wait: offset.seconds).perform_later(sync.id)
+    end
+  end
+end
diff --git a/backend/app/jobs/artist_sync_check_job.rb b/backend/app/jobs/artist_sync_check_job.rb
new file mode 100644
index 0000000..167405b
--- /dev/null
+++ b/backend/app/jobs/artist_sync_check_job.rb
@@ -0,0 +1,43 @@
+class ArtistSyncCheckJob < ApplicationJob
+  queue_as :syncs
+
+  # O detector de novidade do sync diário por artista: compara o catálogo
+  # actual do Spotify com o snapshot conhecido e, havendo álbuns novos,
+  # cria um ArtistImport SÓ com eles - o pipeline existente (progresso,
+  # dedupe por ISRC nos SongImports, matcher) faz o resto. O snapshot
+  # guarda a UNIÃO: um álbum que o Spotify esconda e volte a mostrar não
+  # pode re-importar-se como "novo".
+  def perform(artist_sync_id)
+    sync = ArtistSync.find_by(id: artist_sync_id)
+    return unless sync&.enabled
+
+    identity = sync.user.identities.find_by(provider: "spotify")
+    return unless identity
+
+    client = SpotifyClient.new(identity)
+    current_ids = client.each_artist_album(sync.spotify_artist_id).map { |a| a["id"] }.compact.uniq
+    known = Array(sync.known_album_ids)
+    new_ids = current_ids - known
+
+    if new_ids.any?
+      import = ArtistImport.create!(
+        user: sync.user,
+        spotify_artist_id: sync.spotify_artist_id,
+        spotify_artist_name: sync.artist_name,
+        album_ids: new_ids,
+        state: "queued",
+        total_albums: new_ids.size,
+        last_message: "Novo lançamento detectado pelo sync diário…"
+      )
+      ArtistImportJob.perform_later(import.id)
+    end
+
+    sync.update!(known_album_ids: known | current_ids, last_checked_at: Time.current)
+  rescue SpotifyClient::TokenRefreshFailed => e
+    Rails.logger.warn("[ArtistSyncCheckJob ##{artist_sync_id}] token refresh failed: #{e.message}")
+    sync&.update!(last_checked_at: Time.current)
+  rescue SpotifyClient::UpstreamError => e
+    Rails.logger.warn("[ArtistSyncCheckJob ##{artist_sync_id}] spotify upstream: #{e.message[0, 200]}")
+    sync&.update!(last_checked_at: Time.current)
+  end
+end
diff --git a/backend/app/models/artist_sync.rb b/backend/app/models/artist_sync.rb
new file mode 100644
index 0000000..e0f688f
--- /dev/null
+++ b/backend/app/models/artist_sync.rb
@@ -0,0 +1,25 @@
+# Sync diário de um artista (pedido do dono, 2026-08-17): "seguir" um
+# artista importa automaticamente os lançamentos que apareçam no Spotify
+# DEPOIS de o sync ligar. O estado é um snapshot de ids de álbum já
+# conhecidos; o diff diário contra o catálogo actual é o detector de
+# novidade, e a importação em si reutiliza o pipeline ArtistImport inteiro
+# (progresso incluído).
+class ArtistSync < ApplicationRecord
+  belongs_to :user
+
+  validates :spotify_artist_id, presence: true
+  validates :spotify_artist_id, uniqueness: { scope: :user_id }
+
+  scope :viewable_by, ->(user) { where(user:) }
+  scope :due, -> { where(enabled: true) }
+
+  def creatable_by?(user)
+    user == self.user
+  end
+
+  def updatable_by?(user)
+    user == self.user
+  end
+
+  alias destroyable_by? updatable_by?
+end
diff --git a/backend/config/recurring.yml b/backend/config/recurring.yml
index 3e9a6c1..c516056 100644
--- a/backend/config/recurring.yml
+++ b/backend/config/recurring.yml
@@ -35,6 +35,10 @@ production:
     class: SpotifyDailySyncDispatcherJob
     queue: default
     schedule: every day at 4:00 am
+  artist_daily_sync:
+    class: ArtistDailySyncDispatcherJob
+    queue: default
+    schedule: every day at 5:00 am
   notepad_cleanup:
     class: NotepadCleanupJob
     queue: default
diff --git a/backend/config/routes.rb b/backend/config/routes.rb
index ced717b..57c019b 100644
--- a/backend/config/routes.rb
+++ b/backend/config/routes.rb
@@ -178,6 +178,10 @@ Rails.application.routes.draw do
   patch "spotify_syncs/settings", to: "spotify_syncs#update_settings"
   post  "spotify_syncs",          to: "spotify_syncs#create"
 
+  get    "artist_syncs",     to: "artist_syncs#index"
+  post   "artist_syncs",     to: "artist_syncs#create"
+  delete "artist_syncs/:id", to: "artist_syncs#destroy"
+
   get  "artist_imports/search", to: "artist_imports#search"
   get  "artist_imports/albums", to: "artist_imports#albums"
   get  "artist_imports",        to: "artist_imports#index"
diff --git a/backend/db/migrate/20260817090000_create_artist_syncs.rb b/backend/db/migrate/20260817090000_create_artist_syncs.rb
new file mode 100644
index 0000000..e46e82c
--- /dev/null
+++ b/backend/db/migrate/20260817090000_create_artist_syncs.rb
@@ -0,0 +1,18 @@
+class CreateArtistSyncs < ActiveRecord::Migration[8.0]
+  def change
+    create_table :artist_syncs do |t|
+      # users.id é string neste schema (ver artist_imports): referência à mão.
+      t.string :user_id, null: false
+      t.string :spotify_artist_id, null: false
+      t.string :artist_name
+      t.boolean :enabled, null: false, default: true
+      # Snapshot dos ids de álbum conhecidos NO MOMENTO em que o sync liga:
+      # "seguir" significa lançamentos novos a partir daí, nunca a
+      # discografia inteira outra vez.
+      t.jsonb :known_album_ids, null: false, default: []
+      t.datetime :last_checked_at
+      t.timestamps
+    end
+    add_index :artist_syncs, [ :user_id, :spotify_artist_id ], unique: true
+  end
+end
diff --git a/backend/db/schema.rb b/backend/db/schema.rb
index 1f8bb38..0159590 100644
--- a/backend/db/schema.rb
+++ b/backend/db/schema.rb
@@ -10,7 +10,7 @@
 #
 # It's strongly recommended that you check this file into your version control system.
 
-ActiveRecord::Schema[8.0].define(version: 2026_08_02_235811) do
+ActiveRecord::Schema[8.0].define(version: 2026_08_17_090000) do
   # These are extensions that must be enabled in order to support this database
   enable_extension "ltree"
   enable_extension "pg_catalog.plpgsql"
@@ -64,6 +64,18 @@ ActiveRecord::Schema[8.0].define(version: 2026_08_02_235811) do
     t.index ["user_id", "created_at"], name: "index_artist_imports_on_user_id_and_created_at"
   end
 
+  create_table "artist_syncs", force: :cascade do |t|
+    t.string "user_id", null: false
+    t.string "spotify_artist_id", null: false
+    t.string "artist_name"
+    t.boolean "enabled", default: true, null: false
+    t.jsonb "known_album_ids", default: [], null: false
+    t.datetime "last_checked_at"
+    t.datetime "created_at", null: false
+    t.datetime "updated_at", null: false
+    t.index ["user_id", "spotify_artist_id"], name: "index_artist_syncs_on_user_id_and_spotify_artist_id", unique: true
+  end
+
   create_table "artists", force: :cascade do |t|
     t.string "name", null: false
     t.string "canonical_name", null: false
@@ -335,7 +347,7 @@ ActiveRecord::Schema[8.0].define(version: 2026_08_02_235811) do
     t.string "user_id", null: false
     t.string "title", default: "", null: false
     t.string "status", default: "draft", null: false
-    t.jsonb "schema", default: {"fields" => []}, null: false
+    t.jsonb "schema", default: {"fields"=>[]}, null: false
     t.jsonb "theme", default: {}, null: false
     t.jsonb "settings", default: {}, null: false
     t.string "short_link_id"
diff --git a/backend/test/jobs/artist_daily_sync_dispatcher_job_test.rb b/backend/test/jobs/artist_daily_sync_dispatcher_job_test.rb
new file mode 100644
index 0000000..68260c5
--- /dev/null
+++ b/backend/test/jobs/artist_daily_sync_dispatcher_job_test.rb
@@ -0,0 +1,20 @@
+# frozen_string_literal: true
+
+require "test_helper"
+
+class ArtistDailySyncDispatcherJobTest < ActiveJob::TestCase
+  def run_job
+    job = ArtistDailySyncDispatcherJob.new
+    Job.create!(id: job.job_id)
+    job.perform_now
+  end
+
+  test "enqueues one check per enabled sync and skips disabled ones" do
+    ArtistSync.create!(user: users(:one), spotify_artist_id: "s1")
+    ArtistSync.create!(user: users(:one), spotify_artist_id: "s2", enabled: false)
+    ArtistSync.create!(user: users(:two), spotify_artist_id: "s1")
+
+    run_job
+    assert_enqueued_jobs 2, only: ArtistSyncCheckJob
+  end
+end
diff --git a/backend/test/jobs/artist_sync_check_job_test.rb b/backend/test/jobs/artist_sync_check_job_test.rb
new file mode 100644
index 0000000..b2f6c0b
--- /dev/null
+++ b/backend/test/jobs/artist_sync_check_job_test.rb
@@ -0,0 +1,89 @@
+# frozen_string_literal: true
+
+require "test_helper"
+require "minitest/mock"
+
+# O detector de novidade do sync diário por artista: a linha que estes
+# testes fixam é que "seguir" importa SÓ o que aparecer depois do snapshot,
+# exactamente uma vez, e que um catálogo que encolhe nunca re-importa nada.
+class ArtistSyncCheckJobTest < ActiveJob::TestCase
+  setup do
+    @user = users(:one)
+    @identity = @user.identities.create!(provider: "spotify", uid: "uid-1")
+    @sync = ArtistSync.create!(
+      user: @user,
+      spotify_artist_id: "spot-artist-1",
+      artist_name: "Laura Les",
+      known_album_ids: %w[a1 a2]
+    )
+  end
+
+  def run_job(id)
+    job = ArtistSyncCheckJob.new(id)
+    Job.create!(id: job.job_id)
+    job.perform_now
+  end
+
+  def fake_client(album_ids)
+    client = Object.new
+    albums = album_ids.map { |id| { "id" => id } }
+    client.define_singleton_method(:each_artist_album) { |_artist_id| albums.each }
+    client
+  end
+
+  test "a new album creates an import with ONLY the new ids and updates the snapshot" do
+    SpotifyClient.stub(:new, fake_client(%w[a1 a2 a3])) do
+      assert_enqueued_jobs 1, only: ArtistImportJob do
+        run_job(@sync.id)
+      end
+    end
+
+    import = ArtistImport.viewable_by(@user).order(created_at: :desc).first
+    assert_equal %w[a3], import.album_ids
+    assert_equal "queued", import.state
+    assert_equal "Laura Les", import.spotify_artist_name
+    assert_equal %w[a1 a2 a3], @sync.reload.known_album_ids.sort
+    assert_not_nil @sync.last_checked_at
+  end
+
+  test "no new albums means no import, only a fresh last_checked_at" do
+    SpotifyClient.stub(:new, fake_client(%w[a1 a2])) do
+      assert_no_enqueued_jobs only: ArtistImportJob do
+        run_job(@sync.id)
+      end
+    end
+    assert_not_nil @sync.reload.last_checked_at
+  end
+
+  test "a shrunken catalogue never re-imports when the album returns" do
+    # O Spotify esconde a2 hoje...
+    SpotifyClient.stub(:new, fake_client(%w[a1])) do
+      run_job(@sync.id)
+    end
+    assert_equal %w[a1 a2], @sync.reload.known_album_ids.sort, "a união preserva o que já se conhecia"
+
+    # ...e mostra-o outra vez amanhã: não é um lançamento novo.
+    SpotifyClient.stub(:new, fake_client(%w[a1 a2])) do
+      assert_no_enqueued_jobs only: ArtistImportJob do
+        run_job(@sync.id)
+      end
+    end
+  end
+
+  test "disabled syncs and unlinked accounts do nothing" do
+    @sync.update!(enabled: false)
+    SpotifyClient.stub(:new, fake_client(%w[a1 a2 a3])) do
+      assert_no_enqueued_jobs only: ArtistImportJob do
+        run_job(@sync.id)
+      end
+    end
+
+    @sync.update!(enabled: true)
+    @identity.destroy!
+    SpotifyClient.stub(:new, fake_client(%w[a1 a2 a3])) do
+      assert_no_enqueued_jobs only: ArtistImportJob do
+        run_job(@sync.id)
+      end
+    end
+  end
+end
```
