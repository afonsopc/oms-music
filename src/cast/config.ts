/**
 * O receptor do Chromecast. Enquanto o dono não registar o receptor próprio
 * (docs/cast.md, "Registar o receptor"), é o Default Media Receiver do
 * Google: capa, título, artista e a barra, sem os visuais.
 *
 * Quando houver App ID: EXPO_PUBLIC_CAST_APP_ID=<id> no build (web e
 * desktop apanham-no logo; iOS e Android precisam de build novo, porque o
 * SDK nativo lê o id no arranque - app.config.js passa-o ao plugin).
 */
export const DEFAULT_MEDIA_RECEIVER_APP_ID = "CC1AD845";

export const CAST_RECEIVER_APP_ID: string =
  (process.env.EXPO_PUBLIC_CAST_APP_ID ?? "").trim() || DEFAULT_MEDIA_RECEIVER_APP_ID;

/** O receptor próprio sabe ler isto (visuais, letra); o do Google ignora. */
export const usesCustomReceiver = (): boolean => CAST_RECEIVER_APP_ID !== DEFAULT_MEDIA_RECEIVER_APP_ID;

/** Quantas músicas vão de cada vez para a fila do Chromecast. */
export const CHROMECAST_WINDOW = 30;
