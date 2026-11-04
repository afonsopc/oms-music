# Shell desktop de oms-music (Tauri v2)

Fase F5 do plano "uma so app": o MESMO export web que serve
`music.omelhorsite.pt` dentro de uma moldura nativa. O audio fica no webview
nesta fase (o spike 4 validou que um `<audio>` activo marca o processo WebKit
como audivel: sem App Nap, sem throttling, media time 1:1 com o relogio); o
motor Rust (symphonia/rubato/cpal) e F6.

## Layout

- `package.json` - o UNICO package.json JS onde o desktop pode declarar
  dependencias (`@tauri-apps/cli` para o build, `@tauri-apps/api` para o
  `bindings.ts` gerado typecheckar aqui). O package.json da app nao muda.
- `src-tauri/` - o crate do shell: janela principal, tray, mini-player
  NSPanel, souvlaki (media keys / Now Playing / MPRIS), single-instance,
  window-state, updater assinado.
- `bindings.ts` - GERADO pelo tauri-specta (`bun run bindings`). E o
  contrato da ponte; o lado da app e `src/desktop/` no repo principal, que
  fala com `window.__TAURI__` (withGlobalTauri) para nao ganhar dependencias.
- `keys/` - par de chaves do updater. `updater.key` (privada) esta
  gitignored; `updater.key.pub` esta espelhada em `plugins.updater.pubkey`
  no `tauri.conf.json`.

## Correr

```sh
cd desktop
bun install

# Dev: abre o shell contra o dev server do expo (porta 8081).
bun run dev

# Build macOS: .app + .dmg, assinado com o Developer ID (sem notarizar). Reutiliza ../dist se existir;
# OMS_FORCE_WEB_BUILD=1 obriga a repetir scripts/build-web.sh (2-3 min).
bun run build

# Regenerar bindings.ts depois de mexer em comandos/eventos Rust.
bun run bindings

# Build Linux: .deb + AppImage num container Ubuntu 22.04 (Docker; a base
# de glibc mais antiga suportada com webkit2gtk-4.1). Exige ../dist pronto
# (scripts/build-web.sh na raiz) e keys/updater.key. Por omissao compila a
# arch nativa do Docker (arm64 neste Mac); OMS_LINUX_PLATFORM=linux/amd64
# cruza via Rosetta/QEMU, varias vezes mais lento. O x86_64 "a serio" sai
# do CI (.github/workflows/desktop-builds.yml, sem secrets incluidos).
bun run build:linux
```

Artefactos: `src-tauri/target/release/bundle/macos/OMS Music.app` e
`src-tauri/target/release/bundle/dmg/OMS Music_<versao>_aarch64.dmg`;
Linux em `dist-linux/` (o target do container vive num volume Docker,
`oms-music-linux-target`, nao no target/ do host).

Em Linux o shell exporta ele proprio, antes de criar o webview, a escada de
variaveis de graficos do WebKitGTK (`src-tauri/src/main.rs`): com driver
NVIDIA detectado poe `__NV_DISABLE_EXPLICIT_SYNC=1` e
`WEBKIT_DISABLE_DMABUF_RENDERER=1`; `OMS_WEBKIT_SAFE=1` desliga tambem o
compositing acelerado (valvula de escape para VMs/drivers fora da matriz).
Valores ja presentes no ambiente nunca sao pisados.

## Ponte JS <-> Rust

- Rust -> JS: evento `media-command`, payload identico ao `RemoteCommand` de
  `src/player/lockScreen.ts` (`{"kind":"toggle"}`, `{"kind":"seek","seconds":42}`).
  Emitido pelas teclas de media, Now Playing/MPRIS e pelo tray.
- JS -> Rust: `update_now_playing` (metadata fresca por musica, mesma
  resolucao de artwork do lock screen) e `update_playback` (flips, seeks e um
  tick de 5s enquanto toca - nunca os 4 Hz do store).
- Mini-player: `miniplayer_toggle` / `miniplayer_set_size` /
  `miniplayer_get_size`, presets `bar` (420x84), `rect` (420x240), `square`
  (360x440), persistidos em `app_config_dir/miniplayer.json`. No macOS a
  janela e promovida a NSPanel (nao-activante, flutuante, todos os Spaces);
  noutras plataformas fica always-on-top normal. A janela carrega o bundle
  com `?miniplayer=1`; o layout dedicado e trabalho da UI (F3+), o shell so
  garante a moldura.

A janela principal abre a 1280x820 (>= 900px: layout desktop). O INVARIANTE
mantem-se: abaixo de 900px o bundle cai no shell mobile exacto; o shell
nativo nao mexe em layout nenhum.

## Updater

A versao e a da app toda (`version` do package.json da raiz, `bun run version:bump`;
docs/DEVELOPMENT.md, "Versões"). O desktop passou da 1.4.1 para a 2.0.0 para ficar
igual ao telemovel; o updater compara SemVer, por isso a 2.0.0 conta como mais nova.


Assinatura OBRIGATORIA e nao desactivavel por decisao (plano 3.6). O build
falha sem `keys/updater.key` porque `createUpdaterArtifacts` esta ligado - o
pipeline de assinatura e validado em TODOS os builds, nao no dia do release.

- Gerar/rodar chaves: `bun run keys` (ver scripts/generate-updater-keys.sh
  para a politica de rotacao; a privada nunca vive no git, mesma disciplina
  da production.key do site).
- A app procura sozinha (`src-tauri/src/updates.rs`): 20 s depois do
  arranque e de 4 em 4 horas. Havendo versao nova, descarrega e instala em
  segundo plano e pergunta UMA vez "Há uma versão nova. Reiniciar agora?";
  com "Depois" entra no proximo arranque. Em Linux so procura num AppImage
  (deb/Flatpak nao se trocam sozinhos).
- O endpoint `updates.omelhorsite.pt/oms-music-desktop/...` e um 302 no
  Traefik do Mini (omelhorsite: `infra/mini/traefik/dynamic/oms-music-updates.yml`)
  para `releases/latest/download/latest.json` deste repo (publico). Publicar
  uma versao = release no GitHub com o `latest.json` (url + assinatura de
  cada plataforma) como asset; o "latest" do GitHub e o que as apps veem.

## Release macOS (assinado + notarizado)

Uma linha, a partir de `desktop/`, depois de subir a versao em
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`
e `package.json` e de commitar:

```sh
OMS_RELEASE_NOTES="O que muda, numa linha." bun run release
```

`scripts/release-macos.sh` faz tudo: export web novo, build arm64 assinado
com `Developer ID Application: Afonso Coutinho (6FYT6632J8)` (Hardened
Runtime + `Entitlements.plist`), notarizacao e stapler do `.app` (pelo
bundler do Tauri, com `APPLE_API_KEY`/`APPLE_API_ISSUER`/`APPLE_API_KEY_PATH`
tiradas de `~/.appstoreconnect/oms-ci.env`) e do `.dmg` (`notarytool` +
`stapler`), verificacao (`codesign --verify --deep --strict`, `spctl`,
`stapler validate`, tambem no `.app` de dentro do `.app.tar.gz` do updater, e
a chave do `.sig` contra a pubkey), `latest.json`, tag + release `vX.Y.Z` no
GitHub como "latest", e no fim confirma que `updates.omelhorsite.pt` ja da a
versao nova. Termina em `RELEASE_OK vX.Y.Z <sha> <url>`.

- Allow-jit + allow-unsigned-executable-memory no `Entitlements.plist` sao
  OBRIGATORIOS com Hardened Runtime: sem eles a app notarizada morre a
  arrancar num Mac limpo.
- Duas assinaturas independentes: a da Apple (codesign/notarizacao, para o
  Gatekeeper) e a do updater (minisign, `keys/updater.key`, verificada pela
  app antes de instalar). Trocar a identidade Apple nao mexe na do updater.
- A passagem de ad-hoc (ate a 1.2.1) para Developer ID (1.2.2+) e
  transparente: o updater troca o .app no sitio, a sessao vive no
  localStorage do WKWebView (`~/Library/WebKit/pt.omelhorsite.music.desktop`),
  chaveado pelo bundle id e nao pela assinatura, e a app nao usa o keychain.
- `bun run build` tambem assina com o Developer ID (precisa da identidade no
  keychain), mas sem as variaveis APPLE_API_* nao notariza.
- Linux nao passa por aqui (`bun run build:linux`, `scripts/release-local.sh`).

Antes de fechar F5 a serio: repetir o soak do spike 4 (30 min, em bateria,
noutro Space) com ESTE .app empacotado - o veredicto "segue" foi medido no
binario cru do spike.

## Capacidades

`src-tauri/capabilities/main.json`: `core:default` + `window-state:default` +
`updater:default`, para as janelas `main` e `miniplayer`. Sem plugin fs de
todo - o scope de ficheiros mais pequeno possivel e nenhum; downloads offline
(F6) reabrem isso com um glob restrito a `$APPDATA/downloads` chaveado por
media id (nunca fs node id, ver plano 2.4).
