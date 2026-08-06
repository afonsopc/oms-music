/**
 * Import screen (settings > import): four tabs, exactly the web set.
 *
 * The Spotify tab is GATED on `allowed_to_use_spotify` from the account
 * payload: hidden when the flag is absent AND every `/spotify_syncs/*` call
 * behind it also expects a 403 (FR-103). The artist tab stays visible for
 * everyone - it needs a linked Spotify identity, not the allowlist flag, and
 * surfaces the connect/relink banners instead (FR-104).
 */
import React, { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSessionStore } from "@/auth/session";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { TabStrip } from "@/features/settings/ui";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import ArtistImportTab from "./artist";
import FilesImportTab from "./files";
import SpotifyImportTab from "./spotify";
import UrlImportTab from "./url";

type ImportTab = "files" | "url" | "spotify" | "artist";

const PAGE_KEY = "components.music.Settings.ImportPage";

export default function ImportScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const bottomPadding = useContentBottomPadding();
  const topPadding = useContentTopPadding();
  const user = useSessionStore((s) => s.user);
  const spotifyAllowed = user?.allowed_to_use_spotify === true;

  const [tab, setTab] = useState<ImportTab>("files");

  const tabs = useMemo(() => {
    const entries: { id: ImportTab; label: string }[] = [
      { id: "files", label: t(`${PAGE_KEY}.tabFiles`) },
      { id: "url", label: t(`${PAGE_KEY}.tabUrl`) },
    ];
    if (spotifyAllowed) entries.push({ id: "spotify", label: t(`${PAGE_KEY}.tabSpotify`) });
    entries.push({ id: "artist", label: t(`${PAGE_KEY}.tabArtist`) });
    return entries;
  }, [spotifyAllowed, t]);

  // Losing the flag mid-session must not strand the user on a hidden tab.
  const activeTab: ImportTab = tab === "spotify" && !spotifyAllowed ? "files" : tab;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <View style={{ paddingTop: 16, gap: 8 }}>
        <View style={{ paddingHorizontal: 16, gap: 4 }}>
          <Text style={{ color: tokens.foreground, fontSize: 26, fontWeight: "800" }}>
            {t(`${PAGE_KEY}.title`)}
          </Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
            {t(`${PAGE_KEY}.description`)}
          </Text>
        </View>
        <TabStrip tabs={tabs} value={activeTab} onChange={setTab} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingTop: topPadding, paddingBottom: bottomPadding, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {activeTab === "files" ? <FilesImportTab /> : null}
        {activeTab === "url" ? <UrlImportTab /> : null}
        {activeTab === "spotify" ? <SpotifyImportTab /> : null}
        {activeTab === "artist" ? <ArtistImportTab /> : null}
      </ScrollView>
    </View>
  );
}
