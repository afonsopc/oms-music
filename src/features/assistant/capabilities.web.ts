/**
 * Web e computador: o assistente pode importar por link, seguir artistas e
 * sincronizar playlists do YouTube Music (o serviço oms-music-import). SÓ
 * neste ficheiro .web.ts: o Metro não o leva para iOS nem Android.
 */
export const assistantCapabilities = (): string[] => ["imports"];
