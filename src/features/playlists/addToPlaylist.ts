/**
 * Global add-to-playlist session (FR-49). Any surface's song menu opens the
 * one shared dialog through this vanilla store; the host component
 * (AddToPlaylistHost) subscribes and renders the wired dialog above the app.
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { Song } from "@/domain/song";

interface AddToPlaylistState {
  song: Song | null;
}

export const addToPlaylistStore = createStore<AddToPlaylistState>()(() => ({
  song: null,
}));

export const openAddToPlaylist = (song: Song): void => {
  addToPlaylistStore.setState({ song });
};

export const closeAddToPlaylist = (): void => {
  addToPlaylistStore.setState({ song: null });
};

export const useAddToPlaylistSong = (): Song | null =>
  useStore(addToPlaylistStore, (s) => s.song);
