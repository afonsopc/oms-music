# App Store e Play Store: nada de importar de fora

A Apple recusa apps que sincronizam de outros serviços de música ou que
descarregam de sites de vídeo (regras 5.2.2 e 5.2.3, e 3.1.1 para links). Por
isso, tudo o que traz música de FORA vive num serviço à parte, o
`oms-music-import`, com a página em https://import.omelhorsite.pt. A app só
importa os ficheiros do próprio utilizador (definições > importar, que chama
`POST /songs/import`).

## Regras

- A app (iOS, Android, web e desktop) nunca volta a ter importação de fora:
  nada de sincronizar com outros serviços, importar por link, pesquisa
  externa, trocar a fonte de uma música, nem mostrar de onde veio uma música.
  As playlists mantidas por fora aparecem só como "Sincronizada"
  (`playlist.synced`), sem o nome de nenhum serviço.
- O único sítio que fala da página de importação é
  `src/features/import/elsewhere.web.tsx`: uma linha abaixo dos ficheiros, só
  na web e no desktop. Os textos ficam DENTRO desse ficheiro, nunca nos
  catálogos partilhados (`src/i18n/catalogs/*.json` vão para as apps
  nativas). O par nativo, `elsewhere.tsx`, devolve `null`. O Metro nunca leva
  um `.web.tsx` para iOS nem Android.
- No desktop o link abre no browser do sistema pelo comando do shell
  `open_import_page` (`desktop/src-tauri/src/login.rs`), que só abre esse
  endereço fixo.
- O SDK (`@omelhorsite/sdk`) vai inteiro para dentro da app, por isso está
  remendado com `bun patch` (`patches/`, `patchedDependencies` no
  `package.json`): saíram as importações, as sincronizações, a pesquisa
  externa, a troca de fonte, o downloader das ferramentas e as palavras que
  os nomeavam. Um `bun install` limpo aplica o remendo. Ao subir a versão do
  SDK, refazer o remendo (`bun patch @omelhorsite/sdk`, editar,
  `bun patch --commit node_modules/@omelhorsite/sdk`).
- O teste `src/boot/__tests__/appStore.test.ts` falha se algum ficheiro de
  `src/` que vá para as apps nativas (tudo menos `*.web.ts(x)` e
  `__tests__`), ou os catálogos, nomear esses serviços ou a página de
  importação, e se o SDK instalado não estiver remendado.

## Verificação antes de qualquer build iOS ou Android

```bash
bunx expo export --platform ios --no-bytecode --output-dir /tmp/omsm-ios-export
bunx expo export --platform android --no-bytecode --output-dir /tmp/omsm-android-export
grep -i -o -E "spotify|youtube|soundcloud|bandcamp|yt-dlp|ytdlp|import\.omelhorsite|song_imports|external_search|rematch|match_candidates|artist_imports|artist_syncs|playlist_imports|itunes" -r /tmp/omsm-ios-export | sort | uniq -c
grep -i -o -E "spotify|youtube|soundcloud|bandcamp|yt-dlp|ytdlp|import\.omelhorsite|song_imports|external_search|rematch|match_candidates|artist_imports|artist_syncs|playlist_imports|itunes" -r /tmp/omsm-android-export | sort | uniq -c
```

O de iOS tem de sair vazio. No Android aparecem hoje duas linhas `youtube`
que não são nossas: são nomes de ícones (`youtube_activity`,
`youtube_searched_for`) na tabela de símbolos Material do `expo-symbols`
(`build/android/symbols.json`). Qualquer outra coisa trava o build.
