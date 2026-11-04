/**
 * Import screen (settings > import): the user's own files, nothing else.
 *
 * On web and desktop a short line below the upload points to the separate
 * import page (`./elsewhere.web.tsx`); on iOS and Android `./elsewhere.tsx`
 * renders nothing, and that file is the only place the line exists. See
 * docs/app-store.md.
 */
import React from "react";
import { ScrollView, Text, View } from "react-native";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import ImportElsewhere from "./elsewhere";
import FilesImportTab from "./files";

const PAGE_KEY = "components.music.Settings.ImportPage";

export default function ImportScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const bottomPadding = useContentBottomPadding();
  const topPadding = useContentTopPadding();

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      {/* The heading is FIXED, outside the scroll view, so the safe-area inset
          belongs here: applying it to the scrolling content left the title
          itself under the dynamic island. */}
      <View style={{ paddingTop: topPadding, gap: 8 }}>
        <View style={{ paddingHorizontal: 16, gap: 4 }}>
          <Text style={{ color: tokens.foreground, fontSize: 26, fontWeight: "800" }}>
            {t(`${PAGE_KEY}.title`)}
          </Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
            {t(`${PAGE_KEY}.description`)}
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <FilesImportTab />
        <ImportElsewhere />
      </ScrollView>
    </View>
  );
}
