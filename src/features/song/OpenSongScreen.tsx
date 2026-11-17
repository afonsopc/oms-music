/**
 * /song/<id>: abrir UMA música vinda de fora (o site de importação, um link
 * partilhado). Começa a tocá-la e troca este ecrã pelo álbum dela, com a
 * linha em destaque, para ficar à vista de onde veio. Id inválido ou música
 * que não é da pessoa: volta ao Início.
 */
import React, { useEffect, useRef } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useSong } from "@/api/queries/songs";
import { getTransport } from "@/contracts/transport";
import type { SongId } from "@/domain/ids";
import { useT } from "@/i18n";
import { songHighlightRoute } from "@/lib/routes";
import { useTheme } from "@/theme/provider";

export default function OpenSongScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const songId = Number(params.id);
  const valid = Number.isInteger(songId) && songId > 0;
  const query = useSong(valid ? (songId as SongId) : null);
  const router = useRouter();
  const { tokens } = useTheme();
  const t = useT();
  const done = useRef(false);

  const song = query.data ?? null;
  useEffect(() => {
    if (!song || done.current) return;
    done.current = true;
    getTransport().setQueue([song], 0, { shuffle: false });
    router.replace(songHighlightRoute(song));
  }, [song, router]);

  if (!valid) return <Redirect href="/home" />;

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24, backgroundColor: tokens.background }}>
      {query.isError ? (
        <>
          <Text style={{ color: tokens.mutedForeground, fontSize: 15, textAlign: "center" }}>
            {t("components.music.AlbumView.errorLoadingSongs")}
          </Text>
          <Text
            accessibilityRole="button"
            onPress={() => router.replace("/home")}
            style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600", padding: 12 }}
          >
            {t("native.shell.tabHome")}
          </Text>
        </>
      ) : (
        <ActivityIndicator color={tokens.mutedForeground} />
      )}
    </View>
  );
}
