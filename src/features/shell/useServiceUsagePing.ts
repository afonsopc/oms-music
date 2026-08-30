/**
 * FR-22: POST /service_usages { service_id: "music" } fire-and-forget on the
 * first authed mount. Mounted by (main)/_layout, which only exists while
 * authed, so a logout + re-login pings again (a new "entry").
 */
import { useEffect, useRef } from "react";
import { oms } from "@/api/oms";
import { useSessionStore } from "@/auth/session";

export const useServiceUsagePing = (): void => {
  const status = useSessionStore((s) => s.status);
  const sent = useRef(false);

  useEffect(() => {
    if (status === "authed" && !sent.current) {
      sent.current = true;
      oms()
        .content.serviceUsages.record("music")
        .catch(() => {
          // Fire-and-forget, no UI (FR-22).
        });
    }
  }, [status]);
};
