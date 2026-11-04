import React, { useEffect } from "react";
import { useRouter } from "expo-router";
import { isPlayerSheetAvailable, openPlayerSheet } from "@/features/player/sheet/sheetStore";
import { NowPlayingScreen } from "../PlayerPager";

/**
 * /now-playing: onde há folha do leitor (telemóvel), a rota abre-a e sai de
 * si própria; onde não há (computador), mostra o leitor como antes.
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
  return <NowPlayingScreen />;
}
