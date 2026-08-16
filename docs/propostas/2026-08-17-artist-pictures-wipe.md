# Proposta: o refetch de imagens de artista apaga fotos boas (bug 2.3)

Escrito pela sessão cloud de 2026-08-17. Diagnóstico feito com o repo
`omelhorsite` clonado em leitura e com a suite de testes Rails A CORRER
nesta máquina (postgres local); o diff abaixo está testado, não inventado.

## O mecanismo, confirmado de ponta a ponta

1. `ArtistPicturesFetcher` tem um TTL de ~3 dias (jitter de 1 dia). Cada
   abertura de página de artista com o TTL vencido refaz o fetch ao Deezer.
2. O match do resultado é por igualdade EXACTA do nome canónico
   (`Artist.canonical`). A pesquisa do Deezer é fuzzy e nem sempre devolve
   o nome exacto que bateu da última vez; variantes de acentos e pontuação
   falham sempre ("Beyonce" da biblioteca vs "Beyoncé" do Deezer;
   "Tyler, The Creator" - a vírgula não é normalizada).
3. `persist!` corre TAMBÉM quando o match falha (`data = nil`) e faz
   `artist.update!(picture: nil, picture_small: nil, ..., pictures_fetched_at: now)`.
   **Um miss escreve NULL por cima de fotos boas já guardadas.**
4. No frontend (`src/domain/artwork.ts`, `artistImageSource`), sem
   `picture_*` a cadeia cai para `fallback_artwork_media_id` - que é uma
   CAPA DE ÁLBUM. Exactamente o sintoma: "artistas que já tiveram boas
   imagens do Deezer aparecem agora com a capa do álbum".

## A correcção (testada: 12 runs, 0 failures; os 2 testes novos rebentam contra o código antigo)

- Um miss passa a carimbar SÓ `pictures_fetched_at` (mantém o TTL e a
  janela de retry do backfill) e nunca toca nas colunas `picture_*`.
  Entre "foto de há três dias" e "capa de álbum no lugar da cara", ganha
  sempre a foto antiga.
- Segundo passe de match com acentos dobrados para ASCII
  (`ActiveSupport::Inflector.transliterate`), continuando a exigir o nome
  COMPLETO igual. Nomes não-latinos (que dobram para "?") saltam o passe:
  dois "???" diferentes nunca se podem encontrar.

## O que isto NÃO recupera sozinho

As fotos já apagadas em produção não voltam por si: o backfill só re-visita
`picture: nil` com `pictures_fetched_at` > 60 dias, e a abertura da página
refaz o fetch ao fim do TTL de 3 dias - a classe dos acentos recupera nessa
altura com o passe novo; os misses genuínos continuam misses. Para acelerar,
correr uma vez em produção:

    Artist.where(picture: nil).where.not(pictures_fetched_at: nil)
          .update_all(pictures_fetched_at: 61.days.ago)

(empurra tudo para a janela de retry do backfill; ele limpa a fila a ~100
por 10 minutos, com throttle próprio contra o Deezer.)

## Diff aplicável (git apply no repo omelhorsite)

```diff
diff --git a/backend/app/services/song_services/artist_pictures_fetcher.rb b/backend/app/services/song_services/artist_pictures_fetcher.rb
index 5f469cf..078e609 100644
--- a/backend/app/services/song_services/artist_pictures_fetcher.rb
+++ b/backend/app/services/song_services/artist_pictures_fetcher.rb
@@ -99,11 +99,24 @@ module SongServices
         # used to persist a stranger's photo onto obscure library artists,
         # which then blocked every fallback chain because the row looked
         # populated. No match is a genuine miss.
+        #
+        # Second pass: the same equality with accents folded to ASCII, so a
+        # library "Beyonce" still finds Deezer's "Beyoncé" (and vice versa).
+        # Still a FULL-name equality, never a prefix or a first-result grab.
+        # Names that fold to nothing meaningful (non-latin scripts become
+        # "?") skip the pass entirely - two different "???" must never match.
         list = Array(body["data"])
         canonical = Artist.canonical(name)
-        list.find do |row|
-          Artist.canonical(row["name"]) == canonical
-        end
+        exact = list.find { |row| Artist.canonical(row["name"]) == canonical }
+        return exact if exact
+
+        folded = fold(canonical)
+        return nil if folded.blank? || folded.include?("?")
+        list.find { |row| fold(Artist.canonical(row["name"])) == folded }
+      end
+
+      def fold(value)
+        ActiveSupport::Inflector.transliterate(value.to_s).downcase
       end
 
       # A nil `data` here is a genuine "not on Deezer" miss: stamping
@@ -113,16 +126,28 @@ module SongServices
       # they point at the grey default head - the CDN path's md5 segment is
       # empty ("/images/artist//") and md5_image is blank. Storing those as
       # real pictures would block every fallback chain.
+      #
+      # A miss NEVER overwrites pictures the row already has. The ~3 day TTL
+      # refetches every artist forever, and Deezer's fuzzy search does not
+      # always resurface the exact name it matched last quarter - writing the
+      # NULLs through on those days silently demoted artists with good photos
+      # to the album-art fallback (owner report 2026-08-17: artist pages
+      # showing album covers). Between "a photo from three days ago" and "an
+      # album cover where a face belongs", the old photo wins every time.
       def persist!(artist, data)
         data = nil if placeholder?(data)
-        artist.update!(
-          picture: data&.dig("picture"),
-          picture_small: data&.dig("picture_small"),
-          picture_medium: data&.dig("picture_medium"),
-          picture_big: data&.dig("picture_big"),
-          picture_xl: data&.dig("picture_xl"),
-          pictures_fetched_at: Time.current,
-        )
+        if data.nil?
+          artist.update!(pictures_fetched_at: Time.current)
+        else
+          artist.update!(
+            picture: data["picture"],
+            picture_small: data["picture_small"],
+            picture_medium: data["picture_medium"],
+            picture_big: data["picture_big"],
+            picture_xl: data["picture_xl"],
+            pictures_fetched_at: Time.current,
+          )
+        end
       end
 
       def placeholder?(data)
diff --git a/backend/test/services/artist_pictures_fetcher_test.rb b/backend/test/services/artist_pictures_fetcher_test.rb
index 4f55197..988e6a9 100644
--- a/backend/test/services/artist_pictures_fetcher_test.rb
+++ b/backend/test/services/artist_pictures_fetcher_test.rb
@@ -172,6 +172,65 @@ class ArtistPicturesFetcherTest < ActiveSupport::TestCase
     assert_not_nil @artist.pictures_fetched_at
   end
 
+  # The ~3 day TTL refetches every artist forever, and Deezer's fuzzy search
+  # does not always resurface the exact name it matched before. A miss that
+  # wrote NULLs through demoted artists with good photos to the album-art
+  # fallback (owner report 2026-08-17).
+  test "a later miss never wipes pictures the row already has" do
+    @artist.update!(
+      picture: "p", picture_small: "ps", picture_medium: "pm",
+      picture_big: "pb", picture_xl: "px",
+      pictures_fetched_at: 10.days.ago
+    )
+    empty = OpenStruct.new(success?: true, status: 200, body: { data: [] }.to_json)
+
+    ExternalHttp.stub(:get, empty) do
+      result = SongServices::ArtistPicturesFetcher.perform("Radiohead", user: @user)
+      assert_equal "pm", result.first[:picture_medium], "the kept pictures still serve"
+    end
+
+    @artist.reload
+    assert_equal "p", @artist.picture, "a miss must not overwrite a stored picture"
+    assert_operator @artist.pictures_fetched_at, :>, 1.minute.ago, "the miss still stamps the TTL"
+  end
+
+  test "an accent variant of the same full name still matches" do
+    beyonce = Artist.create!(user: @user, name: "Beyonce")
+    ok = OpenStruct.new(
+      success?: true, status: 200,
+      body: { data: [ {
+        name: "Beyoncé", md5_image: "abc123",
+        picture: "p", picture_small: "ps", picture_medium: "pm",
+        picture_big: "pb", picture_xl: "px"
+      } ] }.to_json
+    )
+
+    ExternalHttp.stub(:get, ok) do
+      result = SongServices::ArtistPicturesFetcher.perform("Beyonce", user: @user)
+      assert_equal "pm", result.first[:picture_medium]
+    end
+
+    assert_equal "p", beyonce.reload.picture
+  end
+
+  test "accent folding never bridges two different non-latin names" do
+    korean = Artist.create!(user: @user, name: "아이유")
+    stranger = OpenStruct.new(
+      success?: true, status: 200,
+      body: { data: [ {
+        name: "이수현", md5_image: "abc123",
+        picture: "p", picture_small: "ps", picture_medium: "pm",
+        picture_big: "pb", picture_xl: "px"
+      } ] }.to_json
+    )
+
+    ExternalHttp.stub(:get, stranger) do
+      assert_equal [], SongServices::ArtistPicturesFetcher.perform("아이유", user: @user)
+    end
+
+    assert_nil korean.reload.picture
+  end
+
   test "network failure does not stamp fetched_at" do
     boom = proc { |*_args, **_kwargs| raise Faraday::ConnectionFailed, "boom" }
 
```
