# Proposta: o matcher do yt-dlp nunca verifica o TÍTULO (bug 2.5)

Escrito pela sessão cloud de 2026-08-17. É a causa mais plausível do
"Part Of Me da Katy Perry não é a música certa", confirmada por leitura do
score e verificada com o score a correr nesta máquina sobre casos sintéticos.

## O mecanismo

O `score_candidate` do sidecar (`services/yt-dlp-downloader/downloader.py`)
pontua: proximidade de duração (gaussiana), tokens do ARTISTA no
título+canal, bónus de canal "- Topic"/oficial, e penalizações de tokens
suspeitos (live/remix/cover/...). **Nunca olha para o título da música.**

Em canais Topic todos os uploads partilham uploader e formatação, portanto
outra música do MESMO artista com duração parecida (±20% passa o corte
duro; a gaussiana é fraca a ±10 s) pontua quase igual à certa - e ganha se
a certa vier mais abaixo no ranking da pesquisa, ou não vier de todo. O
resultado fica gravado com o ISRC do Spotify, e os merges por ISRC
(`songs:dedup_by_isrc`, `songs:dedup_cross_source`) empilham aí os
PlayEvents - o que também alimenta o bug 2.4 (estatísticas mentirosas).

## A correcção (verificada com casos sintéticos)

Passar o título esperado (o `search_title` já viaja no request; o sidecar
só o usava para construir a query) e no score:

- match por PALAVRA INTEIRA dos tokens do título contra o título do
  candidato ("of" já não bate em "official");
- **zero tokens em comum = outra música = rejeição dura**, como uma duração
  descabida;
- caso contrário, bónus proporcional (2.0 × ratio), simétrico ao do artista;
- título esperado noutra escrita (tokens a-z0-9 vazios) salta o filtro em
  vez de rejeitar tudo.

Verificação executada aqui (Katy Perry, 215 s, canal Topic):

| candidato | antes | depois |
| --- | --- | --- |
| "Part of Me" (Topic) | 5.66 | 7.66 |
| "Wide Awake" (Topic, 216 s) | 5.64 (quase empatado!) | rejeitado |
| "Part of Me (cover)" (canal aleatório) | - | 2.62 (vivo, atrás) |
| pedido sem expected_title | 5.66 | 5.66 (retrocompatível) |

## O que isto não corrige

As músicas JÁ descarregadas erradas não se corrigem sozinhas: é preciso
re-importar (apagar a Song errada e repetir o import; o SongImport guarda
`search_*`). Se quiseres, a sessão seguinte pode propor um rake
`songs:reimport SONG_ID=` que re-corre o pipeline com o matcher novo.

## Diff aplicável (git apply no repo omelhorsite)

```diff
diff --git a/services/yt-dlp-downloader/downloader.py b/services/yt-dlp-downloader/downloader.py
index ca53e46..ab00257 100644
--- a/services/yt-dlp-downloader/downloader.py
+++ b/services/yt-dlp-downloader/downloader.py
@@ -92,8 +92,10 @@ def score_candidate(
     expected_duration_s: Optional[float],
     expected_artist: Optional[str],
     rank: int = 0,
+    expected_title: Optional[str] = None,
 ) -> Optional[float]:
-    """Score a flat-search candidate; None means hard-rejected (duration)."""
+    """Score a flat-search candidate; None means hard-rejected (duration or,
+    when an expected title is known, a title that shares nothing with it)."""
     score = (SEARCH_POOL_SIZE - rank) * 0.02
 
     title = (entry.get("title") or "").lower()
@@ -121,6 +123,24 @@ def score_candidate(
             matched = sum(1 for t in tokens if t in haystack)
             score += 2.0 * matched / len(tokens)
 
+    # The scoring used to check duration, artist and provenance but never the
+    # TITLE, so a same-artist same-length other song (an obvious risk on
+    # Topic channels, where every upload shares uploader and formatting)
+    # could outscore the right one. Word-boundary matches on the candidate's
+    # own title: zero overlap with the expected title means it IS another
+    # song - hard reject, same as a duration that's way off. Tokens are
+    # a-z0-9 only, so an expected title in another script yields no tokens
+    # and skips the check instead of rejecting everything.
+    if expected_title:
+        t_tokens = [t for t in re.split(r"[^0-9a-z]+", expected_title.lower()) if t]
+        if t_tokens:
+            t_matched = sum(
+                1 for t in t_tokens if re.search(r"\b" + re.escape(t) + r"\b", title)
+            )
+            if t_matched == 0:
+                return None
+            score += 2.0 * t_matched / len(t_tokens)
+
     if uploader.endswith(" - topic"):
         score += 1.5
     elif "official" in uploader:
@@ -224,6 +244,7 @@ class Downloader:
         search_strategies: Optional[List[Source]] = None,
         expected_artist: Optional[str] = None,
         fallback_query: Optional[str] = None,
+        expected_title: Optional[str] = None,
     ) -> DownloadResult:
         # URL targets resolve directly; on failure they fall back to the search
         # cascade when the caller also provided artist+title (a dead or
@@ -268,7 +289,7 @@ class Downloader:
                 if strat == "youtube":
                     progress_cb("fetching", "scoring youtube candidates", 0.08)
                     search_target = self._pick_youtube_candidate(
-                        target, expected_duration_s, expected_artist
+                        target, expected_duration_s, expected_artist, expected_title
                     )
                 elif strat == "bandcamp":
                     progress_cb("fetching", "searching bandcamp", 0.08)
@@ -300,6 +321,7 @@ class Downloader:
         query: str,
         expected_duration_s: Optional[float],
         expected_artist: Optional[str],
+        expected_title: Optional[str] = None,
     ) -> str:
         ydl_opts = {
             "quiet": True,
@@ -323,7 +345,8 @@ class Downloader:
         best_score: Optional[float] = None
         for rank, entry in enumerate(entries):
             score = score_candidate(
-                entry, query, expected_duration_s, expected_artist, rank
+                entry, query, expected_duration_s, expected_artist, rank,
+                expected_title=expected_title,
             )
             url = entry.get("url") or entry.get("webpage_url")
             logger.info(
diff --git a/services/yt-dlp-downloader/main.py b/services/yt-dlp-downloader/main.py
index 7a2323b..508075a 100644
--- a/services/yt-dlp-downloader/main.py
+++ b/services/yt-dlp-downloader/main.py
@@ -210,6 +210,7 @@ async def _run_download(request_id: str, req: DownloadRequest):
             req.search_strategies,
             req.expected_artist,
             req.fallback_query(),
+            expected_title=req.title,
         )
         results[request_id] = result.file_path
         progress[request_id] = {
```
