# Feature 3.4: três kinds novos de mix (backend TESTADO + cliente pronto)

Sessão cloud de 2026-08-17/18, a responder também aos pedidos por mensagem
("This is", mais variedade). Gerador com 2 testes verdes nesta máquina,
rubocop limpo. O CLIENTE já foi preparado nesta sessão (kinds, gradientes,
stamps, catálogos i18n com os meses por ICU) - commitado no oms-music,
retrocompatível: sem o backend novo, nada muda.

## Os kinds

1. **this_is** ("This Is Laura Les"): as ESSENCIAIS de um artista por
   contagem de plays de sempre - não aleatórias como o top_artist mix -
   preenchidas com o resto do catálogo do artista até 30. Dois artistas de
   sempre (o top_artist já cobre os três de 30 dias).
2. **monthly_rewind** ("O Teu Agosto"): top do mês corrente; só aparece com
   >= 5 músicas para não fingir retrospectiva.
3. **year_mix** ("Mix 2026"): top do ano corrente; >= 10 músicas.

## Diff (git apply no repo omelhorsite)

```diff
diff --git a/backend/app/services/music_mix_generator.rb b/backend/app/services/music_mix_generator.rb
index f582607..4b97236 100644
--- a/backend/app/services/music_mix_generator.rb
+++ b/backend/app/services/music_mix_generator.rb
@@ -25,7 +25,7 @@ class MusicMixGenerator
     "from-emerald-500 to-lime-400",
     "from-violet-600 to-pink-500",
     "from-amber-500 to-red-600",
-    "from-fuchsia-600 to-indigo-500",
+    "from-fuchsia-600 to-indigo-500"
   ].freeze
 
   def self.generate_for(user)
@@ -39,9 +39,12 @@ class MusicMixGenerator
   def generate
     [
       *top_artist_mixes,
+      *this_is_mixes,
+      monthly_rewind,
+      year_mix,
       repeat_rewind,
       time_capsule,
-      discoveries,
+      discoveries
     ].compact
   end
 
@@ -94,6 +97,115 @@ class MusicMixGenerator
       end
     end
 
+    # "This Is <artista>" (pedido do dono, 2026-08-17, o idioma do
+    # Spotify): as ESSENCIAIS de um artista - por contagem de plays de
+    # sempre, nao aleatorias como o top_artist mix - preenchidas com o resto
+    # do catalogo do artista quando os plays nao chegam a 30. Dois artistas
+    # de sempre, para nao duplicar os tres do top_artist (30 dias).
+    def this_is_mixes
+      artist_ids = PlayEvent.where(user: @user)
+                            .joins(song: :song_artists)
+                            .where(song_artists: { role: "primary" })
+                            .group("song_artists.artist_id")
+                            .order(Arel.sql("COUNT(*) DESC"))
+                            .limit(2)
+                            .pluck("song_artists.artist_id")
+      artists_by_id = Artist.where(id: artist_ids).index_by(&:id)
+
+      artist_ids.filter_map do |artist_id|
+        artist = artists_by_id[artist_id]
+        next nil unless artist
+
+        top_ids = PlayEvent.where(user: @user)
+                           .joins(song: :song_artists)
+                           .where(song_artists: { artist_id: artist.id })
+                           .group(:song_id)
+                           .order(Arel.sql("COUNT(*) DESC"))
+                           .limit(30)
+                           .count.keys
+        filler_inner = Song.where(user: @user)
+                           .joins(:song_artists)
+                           .where(song_artists: { artist_id: artist.id })
+                           .where.not(id: top_ids)
+                           .select(:id).distinct
+        filler = Song.where(id: filler_inner)
+                     .order(Arel.sql("RANDOM()"))
+                     .limit(30 - top_ids.size)
+                     .pluck(:id)
+        song_ids = (top_ids + filler).first(30)
+        next nil if song_ids.empty?
+
+        Mix.new(
+          slug: "mix:this_is:#{Digest::SHA1.hexdigest(artist.canonical_name)[0, 8]}",
+          kind: "this_is",
+          title: "This Is #{artist.name}",
+          description: "The essential #{artist.name}, by your own play counts.",
+          title_key: "thisIs",
+          title_params: { artist: artist.name },
+          description_key: "thisIs",
+          description_params: { artist: artist.name },
+          seed: artist.name,
+          artist_id: artist.id,
+          song_ids: song_ids,
+          gradient: gradient_for(artist.name),
+        )
+      end
+    end
+
+    # "O Teu Agosto": o mes corrente em plays. So aparece com materia-prima
+    # suficiente para nao ser uma playlist de tres musicas a fingir de
+    # retrospectiva.
+    def monthly_rewind
+      start = Time.current.beginning_of_month
+      song_ids = PlayEvent.where(user: @user, played_at: start..)
+                          .group(:song_id)
+                          .order(Arel.sql("COUNT(*) DESC"))
+                          .limit(30)
+                          .count.keys
+      return nil if song_ids.size < 5
+
+      Mix.new(
+        slug: "mix:monthly_rewind:#{start.strftime('%Y%m')}",
+        kind: "monthly_rewind",
+        title: "Your #{start.strftime('%B')}",
+        description: "What #{start.strftime('%B')} sounded like.",
+        title_key: "monthlyRewind",
+        title_params: { month: start.month },
+        description_key: "monthlyRewind",
+        description_params: { month: start.month },
+        seed: start.month,
+        artist_id: nil,
+        song_ids: song_ids,
+        gradient: "from-sky-500 to-indigo-600",
+      )
+    end
+
+    # "Mix 2026": o ano em plays, mesmo criterio.
+    def year_mix
+      start = Time.current.beginning_of_year
+      song_ids = PlayEvent.where(user: @user, played_at: start..)
+                          .group(:song_id)
+                          .order(Arel.sql("COUNT(*) DESC"))
+                          .limit(30)
+                          .count.keys
+      return nil if song_ids.size < 10
+
+      Mix.new(
+        slug: "mix:year_mix:#{start.year}",
+        kind: "year_mix",
+        title: "#{start.year} Mix",
+        description: "Your #{start.year}, so far.",
+        title_key: "yearMix",
+        title_params: { year: start.year },
+        description_key: "yearMix",
+        description_params: { year: start.year },
+        seed: start.year,
+        artist_id: nil,
+        song_ids: song_ids,
+        gradient: "from-rose-500 to-purple-600",
+      )
+    end
+
     def repeat_rewind
       song_ids = PlayEvent.where(user: @user, played_at: 90.days.ago..)
                           .group(:song_id)
diff --git a/backend/test/services/music_mix_generator_test.rb b/backend/test/services/music_mix_generator_test.rb
new file mode 100644
index 0000000..68c3760
--- /dev/null
+++ b/backend/test/services/music_mix_generator_test.rb
@@ -0,0 +1,57 @@
+# frozen_string_literal: true
+
+require "test_helper"
+
+# Os tres kinds novos (dono, 2026-08-17): This Is = essenciais por plays de
+# sempre com filler do catalogo; o mix do mes e do ano so aparecem com
+# materia-prima suficiente.
+class MusicMixGeneratorTest < ActiveSupport::TestCase
+  setup do
+    @user = users(:one)
+    @artist = Artist.create!(user: @user, name: "Laura Les")
+    @songs = 3.times.map do |i|
+      song = Song.create!(user: @user, title: "S#{i}", duration: 100)
+      SongArtist.create!(song: song, artist: @artist, role: "primary", position: 1)
+      song
+    end
+  end
+
+  def play!(song, count, at: Time.current)
+    count.times { PlayEvent.create!(user: @user, song: song, played_at: at) }
+  end
+
+  test "this_is ranks by all-time plays and fills from the artist catalogue" do
+    play!(@songs[1], 3, at: 2.months.ago)
+    play!(@songs[0], 1, at: 2.months.ago)
+
+    mixes = MusicMixGenerator.generate_for(@user)
+    this_is = mixes.find { |m| m.kind == "this_is" }
+    assert this_is, "com plays de sempre o this_is existe"
+    assert_equal @songs[1].id, this_is.song_ids.first, "a mais ouvida abre"
+    assert_includes this_is.song_ids, @songs[2].id, "o filler traz o resto do catalogo"
+    assert_equal @artist.id, this_is.artist_id
+    assert_equal({ artist: "Laura Les" }, this_is.title_params)
+  end
+
+  test "monthly and year mixes demand enough material" do
+    play!(@songs[0], 2)
+    mixes = MusicMixGenerator.generate_for(@user)
+    assert_nil mixes.find { |m| m.kind == "monthly_rewind" }, "2 musicas nao fazem um mes"
+    assert_nil mixes.find { |m| m.kind == "year_mix" }
+
+    songs = 10.times.map do |i|
+      s = Song.create!(user: @user, title: "M#{i}", duration: 90)
+      SongArtist.create!(song: s, artist: @artist, role: "primary", position: 1)
+      play!(s, 2)
+      s
+    end
+    mixes = MusicMixGenerator.generate_for(@user)
+    monthly = mixes.find { |m| m.kind == "monthly_rewind" }
+    yearly = mixes.find { |m| m.kind == "year_mix" }
+    assert monthly, "com 10+ musicas o mes existe"
+    assert yearly
+    assert_equal Time.current.month, monthly.title_params[:month]
+    assert_equal Time.current.year, yearly.title_params[:year]
+    assert_includes monthly.song_ids, songs.first.id
+  end
+end
```
