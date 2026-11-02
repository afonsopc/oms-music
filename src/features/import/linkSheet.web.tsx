/**
 * Web fork of the Spotify linking sheet: a browser has no WebView to
 * intercept, but it does not need one - the linking flow opens in a new tab
 * (real browser, real cookies) and the status query refetches when the user
 * comes back. The sheet itself never renders here.
 */
import { useEffect } from "react";
import { buildLinkUrl, desktopLinkStartUrl, oauthErrorKey } from "@/auth/oauth";
import { desktopBrowserSession, isDesktopShell } from "@/desktop/tauri";
import type { LinkSheetProps } from "./linkSheet";

export type { LinkSheetProps } from "./linkSheet";

export const LinkSheet = ({ visible, onDone }: LinkSheetProps) => {
  useEffect(() => {
    if (!visible) return;
    if (isDesktopShell()) {
      // No desktop o separador novo não abre: browser do sistema, e o
      // regresso (`/?spotify=linked|error&spotify_error=`) chega ao shell.
      void desktopBrowserSession(desktopLinkStartUrl("spotify")).then((result) => {
        const code =
          result.type === "success" ? new URL(result.url).searchParams.get("spotify_error") : null;
        onDone(code ? oauthErrorKey(code) : undefined);
      });
      return;
    }
    window.open(buildLinkUrl("spotify"), "_blank", "noopener");
    onDone();
  }, [visible, onDone]);
  return null;
};
