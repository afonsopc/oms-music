/**
 * De onde veio esta build de Android. O APK do site (scripts/android-apk.sh)
 * actualiza-se sozinho: avisa de versões novas e tem "Procurar
 * actualizações", que abrem o APK. O build da Google Play (STORE=play, o
 * AAB) põe extra.distribution = "play" no app.config.js; aí quem actualiza é
 * a loja, e a Play não deixa uma app descarregar nem instalar APKs por fora.
 */
import Constants from "expo-constants";

type Extra = { distribution?: string } | undefined;

export const isPlayDistribution = (extra: Extra): boolean => extra?.distribution === "play";

/** true no build da Google Play: nada de procurar nem abrir APKs. */
export const isPlayBuild = (): boolean =>
  isPlayDistribution(Constants.expoConfig?.extra as Extra);
