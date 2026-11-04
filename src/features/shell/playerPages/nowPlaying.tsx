import React, { useEffect } from "react";
import { Redirect, useRouter } from "expo-router";
import { isPlayerSheetAvailable, openPlayerSheet } from "@/features/player/sheet/sheetStore";

/**
 * /now-playing: onde há folha do leitor (telemóvel), a rota abre-a e sai de
 * si própria; onde não há (computador), o ecrã inteiro é o visualizador
 * (o modo cinema e o leitor esticado saíram a 2026-11-04).
 */
export default function NowPlayingPage() {
  const router = useRouter();
  const [sheet] = React.useState(isPlayerSheetAvailable);
  useEffect(() => {
    if (!sheet) return;
    openPlayerSheet();
    if (router.canGoBack()) router.back();
    else router.replace("/home");
  }, [sheet, router]);
  if (sheet) return null;
  return <Redirect href="/(player)/visualizer" />;
}
