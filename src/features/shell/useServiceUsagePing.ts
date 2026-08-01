/**
 * FR-22: POST /service_usages { service_id: "music" } fire-and-forget on the
 * first authed mount. Mounted by (main)/_layout, which only exists while
 * authed, so a logout + re-login pings again (a new "entry").
 */
import { useEffect, useRef } from "react";
import { postMusicServiceUsage } from "@/api/endpoints/serviceUsages";
import { useSessionStore } from "@/auth/session";

export const useServiceUsagePing = (): void => {
  const status = useSessionStore((s) => s.status);
  const sent = useRef(false);

  useEffect(() => {
    if (status === "authed" && !sent.current) {
      sent.current = true;
      postMusicServiceUsage().catch(() => {
        // Fire-and-forget, no UI (FR-22).
      });
    }
  }, [status]);
};
