// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // desktop/ is the Tauri shell workspace (own deps, generated bindings.ts).
    ignores: ["dist/*", "desktop/*"],
  }
]);
