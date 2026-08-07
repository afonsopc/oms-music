/**
 * Web fork of the Spotify linking sheet: a browser has no WebView to
 * intercept, but it does not need one - the linking flow opens in a new tab
 * (real browser, real cookies) and the status query refetches when the user
 * comes back. The sheet itself never renders here.
 */
import { useEffect } from "react";
import { buildLinkUrl } from "@/auth/oauth";
import type { LinkSheetProps } from "./linkSheet";

export type { LinkSheetProps } from "./linkSheet";

export const LinkSheet = ({ visible, onDone }: LinkSheetProps) => {
  useEffect(() => {
    if (!visible) return;
    window.open(buildLinkUrl("spotify"), "_blank", "noopener");
    onDone();
  }, [visible, onDone]);
  return null;
};
