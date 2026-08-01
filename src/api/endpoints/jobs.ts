/** Jobs REST. During post-submit polling a 404 means "keep waiting" (the row
 *  appears asynchronously); done when finished_at is non-null. */
import { request } from "../client";
import type { Job } from "@/domain/lyrics";

export const getJob = (id: string, watchToken?: string): Promise<Job> =>
  request("GET", `/jobs/${encodeURIComponent(id)}`, {
    params: watchToken ? { watch_token: watchToken } : undefined,
  });
