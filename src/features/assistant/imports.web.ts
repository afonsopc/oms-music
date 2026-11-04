/**
 * Web e computador: as importações que o assistente pede vão ao serviço de
 * importação (oms-music-import) pelos mesmos caminhos da página de importar,
 * que o Traefik encaminha para lá. SÓ neste ficheiro .web.ts (docs/app-store.md).
 */
import { oms } from "@/api/oms";

export type ImportAction =
  | { action: "import_link"; url: string }
  | { action: "follow_artist"; artist: string }
  | { action: "sync_playlist_link"; url: string };

interface ArtistHit {
  id?: string;
  spotify_id?: string;
  name?: string;
}

const sameName = (a: string, b: string): boolean =>
  a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;

export const runImportAction = async (action: ImportAction): Promise<void> => {
  switch (action.action) {
    case "import_link":
      await oms().http.post("/song_imports", { source_url: action.url }, { retry: false });
      return;
    case "sync_playlist_link":
      await oms().http.post("/youtube_syncs", { url: action.url }, { retry: false });
      return;
    case "follow_artist": {
      const found = await oms().http.get<{ spotify?: ArtistHit[] }>("/artist_imports/search", {
        query: { q: action.artist },
        retry: false,
      });
      const hits = found.spotify ?? [];
      const hit = hits.find((h) => h.name && sameName(h.name, action.artist)) ?? hits[0];
      const id = hit?.spotify_id ?? hit?.id;
      if (!id) throw new Error("artist not found");
      await oms().http.post(
        "/artist_syncs",
        { spotify_artist_id: id, spotify_artist_name: hit?.name ?? action.artist },
        { retry: false },
      );
      return;
    }
  }
};
