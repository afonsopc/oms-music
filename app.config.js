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
  return { ...config, expo };
};
