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
 *
 * `#boot` (2026-11-04): o esqueleto da app em HTML e CSS puros, pintado
 * antes de qualquer JS (barra, título, linhas a brilhar; o rail da esquerda
 * no computador). O SessionGate desvanece-o quando o primeiro ecrã monta
 * (features/shell/bootSplash.ts). O fundo segue o tema do sistema, por isso
 * nunca há o clarão branco de um documento vazio.
 */
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

const BOOT_CSS = `
html,body{background:#0a0a0a;color-scheme:dark}
@media (prefers-color-scheme: light){html:not([data-boot=dark]),html:not([data-boot=dark]) body{background:#fff;color-scheme:light}html:not([data-boot=dark]) #boot{--sk:#ececec;--sk2:#f6f6f6}}
html[data-boot=light],html[data-boot=light] body{background:#fff;color-scheme:light}html[data-boot=light] #boot{--sk:#ececec;--sk2:#f6f6f6}
#boot{--sk:#1c1c1c;--sk2:#2a2a2a;position:fixed;inset:0;z-index:2147483646;background:inherit;pointer-events:none;transition:opacity .22s ease-out}
#boot.out{opacity:0}
#boot .w{max-width:760px;margin:0 auto;padding:calc(env(safe-area-inset-top) + 20px) 20px 0}
#boot i{display:block;border-radius:6px;background:linear-gradient(90deg,var(--sk) 0,var(--sk2) 40%,var(--sk) 80%);background-size:300% 100%;animation:bk 1.4s ease-in-out infinite}
#boot .t{width:46%;height:30px;margin:8px 0 28px}
#boot .r{display:flex;gap:14px;align-items:center;margin-bottom:14px}
#boot .a{width:52px;height:52px;flex:none}
#boot .l{flex:1}
#boot .l i{height:13px;margin:6px 0}
#boot .l i+i{width:55%;height:11px}
#boot .side{display:none}
@media (min-width:900px){#boot{display:flex}#boot .side{display:block;width:280px;flex:none;border-right:1px solid var(--sk)}#boot .w{flex:1;padding-top:76px}}
@keyframes bk{0%{background-position:100% 0}100%{background-position:0 0}}
@media (prefers-reduced-motion: reduce){#boot i{animation:none}}
`;

/**
 * As letras da casa (ronda 2, 2026-11-04): Inter para a interface e
 * Newsreader para os títulos, servidas por nós. "OMS Sans" está à cabeça da
 * pilha de sistema do react-native-web (patches/react-native-web*), por isso
 * todo o Text sem fontFamily a usa; sem isto o Linux e o Windows caíam na
 * Arial/Liberation. Só o latin da Inter vai em preload (o resto desce quando
 * uma página precisa dele, pelo unicode-range).
 */
const FONT_CSS = `
@font-face{font-family:"OMS Sans";font-style:normal;font-weight:100 900;font-display:swap;src:url(/fonts/inter-4-latin.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"OMS Sans";font-style:normal;font-weight:100 900;font-display:swap;src:url(/fonts/inter-4-latin-ext.woff2) format("woff2");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:"OMS Serif";font-style:normal;font-weight:100 900;font-display:swap;src:url(/fonts/newsreader-500-latin.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"OMS Serif";font-style:normal;font-weight:100 900;font-display:swap;src:url(/fonts/newsreader-500-latin-ext.woff2) format("woff2");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF}
html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
`;

/** O tema escolhido na app (theme/provider.tsx, kv "oms-music.theme-mode"), antes do JS. */
const BOOT_THEME_JS =
  'try{var m=localStorage.getItem("oms-music.theme-mode");if(m==="dark"||m==="light")document.documentElement.dataset.boot=m}catch(e){}';

const BOOT_ROWS = Array.from({ length: 9 }, (_, i) => (
  <div className="r" key={i}>
    <i className="a" />
    <div className="l">
      <i />
      <i />
    </div>
  </div>
));

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
        <meta name="theme-color" content="#0a0a0a" />
        <script dangerouslySetInnerHTML={{ __html: BOOT_THEME_JS }} />
        <link rel="preload" href="/fonts/inter-4-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <style dangerouslySetInnerHTML={{ __html: FONT_CSS }} />
        <style dangerouslySetInnerHTML={{ __html: BOOT_CSS }} />
      </head>
      <body>
        {children}
        <div id="boot" aria-hidden="true">
          <div className="side" />
          <div className="w">
            <i className="t" />
            {BOOT_ROWS}
          </div>
        </div>
      </body>
    </html>
  );
}
