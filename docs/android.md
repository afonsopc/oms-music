# App Android (APK, fora da Play Store)

A Música para Android é a mesma app Expo (`pt.omelhorsite.music`), compilada
neste Mac e posta para descarregar em https://music.omelhorsite.pt/android/.
Não está na Play Store.

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
  `expo-constants`, que é onde a app o lê. **versionName** = `version` do `app.json`.
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
