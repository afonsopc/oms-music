/**
 * Static HTML shell for `expo export -p web` (web.output "static", set in
 * app.config.js). Only the WEB export reads this file; native builds never
 * touch it. It replaces expo-router's default document so that:
 *
 *  - `lang` says "pt" instead of the default "en" (the app's copy is PT-PT;
 *    runtime i18n via kv does not rewrite the document element).
 *  - the favicon link is guaranteed even if the exporter's own injection
 *    changes between SDKs (duplicate links with the same href are harmless).
 *  - there is a real <meta name="description"> for crawlers, since the
 *    prerendered shells are exactly what a non-JS crawler sees.
 *
 * Deliberately NO static <title> here: the tab shows the FIRST <title> in
 * the document, so a hardcoded one would mask the per-route titles that
 * expo-router/head manages (root _layout provides the fallback instead).
 *
 * The three meta tags and ScrollViewStyleReset mirror expo-router's default
 * document byte for byte - removing any of them changes first-paint layout.
 */
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="pt">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta
          name="description"
          content="A música do omelhorsite.pt: playlists, álbuns, rádios e jams, em qualquer dispositivo."
        />
        <link rel="icon" href="/favicon.ico" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
