/**
 * iOS e Android: o assistente nunca importa (docs/app-store.md). A versão da
 * web e do computador está em ./imports.web.ts.
 */
export type ImportAction =
  | { action: "import_link"; url: string }
  | { action: "follow_artist"; artist: string }
  | { action: "sync_playlist_link"; url: string };

export const runImportAction = async (_action: ImportAction): Promise<void> => {};
