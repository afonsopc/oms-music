/**
 * O receptor do Chromecast: o próprio da OMS Music (App ID 92D04F41,
 * https://music.omelhorsite.pt/cast/receiver/, docs/cast.md), com os visuais
 * e a letra na TV. EXPO_PUBLIC_CAST_APP_ID=<id> no build sobrepõe-no (ex.
 * CC1AD845 para voltar ao Default Media Receiver do Google). iOS e Android
 * leem o id no arranque do SDK nativo (app.config.js passa-o ao plugin), por
 * isso mudar o id pede build novo; web e desktop apanham-no no build da web.
 */
export const DEFAULT_MEDIA_RECEIVER_APP_ID = "CC1AD845";
export const OMS_RECEIVER_APP_ID = "92D04F41";

export const CAST_RECEIVER_APP_ID: string =
  (process.env.EXPO_PUBLIC_CAST_APP_ID ?? "").trim() || OMS_RECEIVER_APP_ID;

export const usesCustomReceiver = (): boolean => CAST_RECEIVER_APP_ID !== DEFAULT_MEDIA_RECEIVER_APP_ID;

/** Quantas músicas vão de cada vez para a fila do Chromecast. */
export const CHROMECAST_WINDOW = 30;
