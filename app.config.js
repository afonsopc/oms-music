const config = require("./app.json");

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
  const expo = { ...config.expo };
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

  return { ...config, expo };
};
