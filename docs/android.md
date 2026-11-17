# App Android (APK de fora da loja, e o AAB para a Google Play)

A Música para Android é a mesma app Expo (`pt.omelhorsite.music`), compilada
neste Mac e posta para descarregar em https://music.omelhorsite.pt/android/.
Ainda não está na Play Store: o build para lá já existe (`STORE=play`, ver
"Google Play" no fim), falta a conta na Play Console.

## Compilar

```sh
bun run android:apk                 # APK assinado do HEAD
PUBLISH=1 bun run android:apk       # e põe-no no site (ver abaixo)
ABIS=arm64-v8a,armeabi-v7a bun run android:apk   # também telemóveis de 32 bits (~68 MB)
```

`scripts/android-apk.sh` compila sempre numa cópia limpa do HEAD (como o
`ios-testflight.sh`): só vai o que está commitado. Passos: clone,
`bun install`, a verificação de `docs/app-store.md` (nada de importar de fora
no bundle; as duas `youtube` são nomes de ícones do Material e ficam de fora),
`expo prebuild -p android`, `gradle assembleRelease`, assinatura.

- **versionCode** = data e hora `AAMMDDHH` (o Android quer um inteiro que só
  sobe; o `2` do `app.json` fica para quem compilar à mão). Passa pelo
  `app.config.js` (`OMS_ANDROID_VERSION_CODE`), por isso também chega ao
  `expo-constants`, que é onde a app o lê. **versionName** = `version` do
  `package.json`, a mesma do iOS e do desktop (docs/DEVELOPMENT.md, "Versões").
- **ABI**: só `arm64-v8a` (todos os telemóveis dos últimos anos). Os dois dão
  68 MB contra ~40.
- Fica em `~/Documents/oms/builds/android/oms-music-<versionCode>.apk` (e
  `oms-music.apk`, o último).
- Ferramentas: OpenJDK 21 do brew (`/opt/homebrew/opt/openjdk@21`) e o SDK em
  `/opt/homebrew/share/android-commandlinetools` (o script põe `JAVA_HOME` e
  `ANDROID_HOME`; o NDK vem sozinho na primeira compilação).

## Chave de assinatura

Uma só chave para as duas apps (esta e a do omelhorsite), alias `oms`,
válida até 2126:

- Mac: `~/.appstoreconnect/android/oms-release.jks` e `keystore.env`
  (palavra-passe; chmod 600).
- Mini: `~/Server/secrets/android/` (cópia igual).
- SHA-256 do certificado:
  `C9:7F:01:00:08:DC:1C:29:9C:78:BE:C0:34:88:CE:12:D4:0C:6A:AB:BA:AB:8F:A3:24:8E:42:EC:17:B5:FC:74`

**Sem esta chave não há actualizações**: o Android só instala um APK novo por
cima do antigo se vier assinado pela mesma chave. Perdê-la obriga cada pessoa a
apagar a app (e as transferências) e instalar de novo. Nunca vai para o git.

## Pôr no site

`PUBLISH=1` envia o APK para o heavy-asset storage do website `oms-music`
(passa dos 25 MiB do Pages) como `/app/oms-music-<versionCode>.apk` e escreve
`public/app/android.json` (`versionCode`, `versionName`, `url`, `size`,
`sha256`). Depois: commit do JSON e `./scripts/publish-osnosite.sh`. O
`build-web.sh` lê o JSON e põe no `_redirects` o endereço fixo
`/app/oms-music.apk` a apontar para o último.

- Página: `public/android/index.html` (estática, pt/en/lv pelo browser, os
  passos para instalar de fora da loja).
- Na web, "Descarregar para Android" aparece no ecrã de entrada só a quem abre
  num Android, e sempre, discreto, no fim das definições
  (`src/features/android/download.web.tsx`; nas apps é `null`).

## Avisar de versões novas

`src/features/android/updateToast.tsx`: no Android, ao arrancar e ao voltar
(no máximo de 6 em 6 h), a app lê `/app/android.json`; com um versionCode
maior aparece "Há uma versão nova · Actualizar", que abre o APK no browser.
A pessoa instala por cima (mesma chave, os dados ficam).

## O que o Android tem e não tem

- Som em segundo plano e controlos no ecrã bloqueado/notificação: os do
  `expo-audio` (`enableBackgroundPlayback`, serviço de media em primeiro plano):
  tocar, pausar e avançar na barra. Seguinte/anterior no ecrã bloqueado não
  (ver `docs/LOCKSCREEN-PATCH.md`, secção 6).
- Entrar: o mesmo `expo-web-browser` (Custom Tab) com volta por `omsmusic://`.
- A app do omelhorsite abre esta quando está instalada (`<queries>` com
  `pt.omelhorsite.music`).

## Google Play (STORE=play, o AAB)

```sh
STORE=play bun run android:apk      # AAB assinado do HEAD, para a Play Console
```

O mesmo `scripts/android-apk.sh`, com as mesmas regras (cópia limpa do HEAD,
a verificação "nada de importar de fora" no bundle, versionCode `AAMMDDHH`,
versionName do `package.json`, a mesma chave). O que muda:

- `gradle bundleRelease` em vez de `assembleRelease`: sai um **AAB**
  (`~/Documents/oms/builds/android/oms-music-play-<versionCode>.aab`) com
  `armeabi-v7a`, `arm64-v8a` e `x86_64`. A Play dá a cada telemóvel só a
  ABI dele, por isso o tamanho do AAB não é o que a pessoa descarrega. Ao
  lado fica `oms-music-play-<versionCode>.permissions.txt`, as permissões do
  manifest final. Não mexe no `oms-music.apk` e `PUBLISH=1` é recusado.
- `OMS_ANDROID_DISTRIBUTION=play` no `app.config.js`:
  - `extra.distribution = "play"` (chega à app pelo `expo-constants`;
    `src/features/android/distribution.ts`, `isPlayBuild()`). Com ele **não
    há** o aviso "Há uma versão nova" (`updateToast.tsx`) nem "Procurar
    actualizações" no perfil (`UpdateRow.tsx`): quem actualiza é a loja, e a
    política da Play proíbe uma app da loja descarregar ou instalar APKs por
    fora.
  - `android.blockedPermissions`: fora do manifest `REQUEST_INSTALL_PACKAGES`
    (nunca esteve, fica garantido), `RECORD_AUDIO` (vem do plugin do
    `expo-audio`; a app não grava), `USE_BIOMETRIC`/`USE_FINGERPRINT` (do
    `expo-secure-store`; não usamos biometria), `SYSTEM_ALERT_WINDOW` e
    `READ`/`WRITE_EXTERNAL_STORAGE` (do template; a app guarda tudo na pasta
    dela e escolhe ficheiros pelo seletor do sistema).
- O script pára se o AAB não estiver assinado, se o manifest final pedir
  `REQUEST_INSTALL_PACKAGES`, ou se o `app.config` embutido não disser
  `"distribution":"play"`.
- O APK de fora (sem `STORE`) fica exactamente como era: sem `extra`, com as
  mesmas permissões e com o aviso de versões novas.

**targetSdk**: 36 (Android 16), o do Expo 57 (`compileSdk`/`targetSdk` 36,
`minSdk` 24). É o mínimo da Play para apps novas e actualizações desde
31-08-2026. As bibliotecas nativas vêm alinhadas a 16 KB (a Play exige-o
para apps com targetSdk 35+): conferido no AAB `26111713`, as 146 `.so` com
`LOAD` a `0x4000`.

**Primeiro AAB** (2026-11-17, HEAD `57098f2`): `oms-music-play-26111713.aab`,
2.1.3, 63 MB (as três ABIs), assinado com a `oms`. Permissões do manifest
final: `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`,
`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `WAKE_LOCK`,
`MODIFY_AUDIO_SETTINGS`, `VIBRATE` e a interna
`DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (porquê de cada uma:
`store/play/console.md`). Sem `AD_ID`.

**Chave**: a Play guarda a chave da app (Play App Signing). Para que quem
tem o APK do site possa passar a actualizar pela loja sem apagar a app, na
primeira subida escolher **usar a nossa chave** (a `oms` acima, exportada
com a ferramenta PEPK que a consola dá) em vez de deixar a Google gerar
outra. Se a Google gerar a dela, a `oms` passa a ser só a chave de upload e
as duas instalações não se misturam (a do site tem de ser apagada antes de
instalar a da loja).

**Ficha da loja**: `store/play/` (títulos, descrições, as respostas da
Segurança dos dados, classificação, público-alvo, conta de teste e o que
falta fazer na Play Console em `store/play/console.md`). Os gráficos
(ícone 512, gráfico de destaque 1024×500, capturas 1080×1920 a partir das da
App Store) fazem-se com `python3 scripts/play-graphics.py`.
