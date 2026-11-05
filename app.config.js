const config = require("./app.json");
// A versão (SemVer) só vive no package.json: iOS, Android, web e desktop
// lêem-na de lá (bun run version:bump; docs/DEVELOPMENT.md, "Versões").
const { version } = require("./package.json");
const { iosBuildNumberProblem } = require("./scripts/ios-build-number");

// Associated Domains is a PAID Apple Developer Program capability. A personal
// (free) team cannot sign a build that requests it: Xcode refuses with "Personal
// development teams do not support the Associated Domains capability" and no
// provisioning profile is created.
//
// Passkeys (FR-13) and verified universal links (FR-20) both need it, so the
// entitlement stays declared in app.json and is stripped here unless the build
// opts in. Once the Apple account is a paid membership AND the two .well-known
// files are live on omelhorsite.pt, build with:
//
//     OMS_PAID_TEAM=1 bunx expo run:ios --device --configuration Release
//
// Android is unaffected: its intent filters carry no such restriction.
module.exports = () => {
  const expo = { ...config.expo, version };
  if (process.env.OMS_PAID_TEAM !== "1") {
    const { associatedDomains, ...iosWithoutAssociatedDomains } = expo.ios;
    expo.ios = iosWithoutAssociatedDomains;
  }

  // Web export mode ("uma so app" F1 / plano 2.1). app.json keeps the
  // historical "single" so the base manifest never changes shape for native
  // tooling; the override lives HERE, next to the other build-variant gate,
  // because this is the one file where such decisions are documented.
  //
  // "static" makes `expo export -p web` prerender one HTML shell per route
  // (what Cloudflare Pages needs for real 404s, per-route <title> and the 7
  // dynamic-route rewrites - see scripts/build-web.sh). The `web` key is only
  // ever read by the web bundler/exporter: `expo run:ios|android`, EAS and
  // the dev client ignore it, so native builds are unaffected by design.
  // Spike 1 (plano, seccao 6.1) measured the export at 99 files / 5.0 MB,
  // nowhere near the Pages limit of 20.000 files.
  expo.web = { ...expo.web, output: "static" };

  // Android (scripts/android-apk.sh): versionCode = data e hora (AAMMDDHH).
  // Vai para o build.gradle no prebuild e para o expo-constants, que é onde
  // a app o lê para saber se há um APK mais novo (features/android).
  if (process.env.OMS_ANDROID_VERSION_CODE) {
    expo.android = { ...expo.android, versionCode: Number(process.env.OMS_ANDROID_VERSION_CODE) };
  }

  // iOS (scripts/ios-testflight.sh): build = data e hora (AAMMDD.HHMM), para
  // o expo-constants o mostrar nas definições. Cada parte tem de caber em 6
  // dígitos, senão o Google Cast aborta a app (scripts/ios-build-number.js).
  const iosBuild = process.env.OMS_IOS_BUILD_NUMBER || expo.ios?.buildNumber;
  const iosBuildProblem = iosBuildNumberProblem(iosBuild);
  if (iosBuildProblem) throw new Error(`build iOS inválido: ${iosBuildProblem}`);
  if (process.env.OMS_IOS_BUILD_NUMBER) {
    expo.ios = { ...expo.ios, buildNumber: process.env.OMS_IOS_BUILD_NUMBER };
  }

  // Transmitir (src/cast): o SDK do Google Cast em iOS e Android. O App ID
  // do receptor fica no binário (o SDK lê-o no arranque), por isso mudá-lo
  // pede build novo. Por omissão o receptor próprio (92D04F41, docs/cast.md,
  // o mesmo de src/cast/config.ts). O plugin põe a permissão de rede local e o Bonjour
  // (_googlecast._tcp) no Info.plist.
  expo.plugins = [
    ...(expo.plugins ?? []),
    [
      "react-native-google-cast",
      {
        receiverAppId: (process.env.EXPO_PUBLIC_CAST_APP_ID || "").trim() || "92D04F41",
        iosStartDiscoveryAfterFirstTapOnCastButton: false,
        // O SDK não procura TVs no arranque: só quando a lista Transmitir
        // abre (src/cast/drivers/nativeCast.ts). Assim nada do Cast corre
        // ao abrir a app por causa de aparelhos guardados de outras vezes.
        iosDisableDiscoveryAutostart: true,
        // Fixa: a 23.x puxa o mediarouter 1.9, que pede compileSdk 37 (o
        // Expo 57 compila contra o 36).
        androidPlayServicesCastFrameworkVersion: "22.3.1",
      },
    ],
  ];
  if (expo.ios?.infoPlist && !expo.ios.infoPlist.NSLocalNetworkUsageDescription) {
    expo.ios = {
      ...expo.ios,
      infoPlist: {
        ...expo.ios.infoPlist,
        NSLocalNetworkUsageDescription:
          "Para encontrar as TVs e colunas da tua rede e transmitir música para elas.",
      },
    };
  }

  return { ...config, expo };
};
