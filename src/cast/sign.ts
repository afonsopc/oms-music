/**
 * O pedido ao servidor: POST /media/cast_urls, até 100 ids de cada vez.
 * Separado de ./media.ts para os testes não arrastarem a sessão nativa.
 */
import { API_BASE_URL } from "@/api/oms";
import { isCookieAuth } from "@/auth/authMode";
import { getToken } from "@/auth/token";
import type { SignedBatch, SignedMedia, SignMedia } from "./media";

/** O servidor aceita até 100 ids por pedido. */
const MAX_IDS = 100;

export const signMediaIds: SignMedia = async (ids) => {
  const out: Record<string, SignedMedia> = {};
  let vizToken: string | null = null;
  for (let i = 0; i < ids.length; i += MAX_IDS) {
    const chunk = ids.slice(i, i + MAX_IDS);
    const cookie = isCookieAuth();
    const token = cookie ? null : getToken();
    const res = await fetch(`${API_BASE_URL}/media/cast_urls`, {
      method: "POST",
      credentials: cookie ? "include" : "omit",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ids: chunk }),
    });
    if (!res.ok) throw new Error(`cast_urls ${res.status}`);
    const body = (await res.json()) as { items?: Record<string, SignedMedia>; viz_token?: string };
    Object.assign(out, body.items ?? {});
    vizToken = body.viz_token ?? vizToken;
  }
  const batch: SignedBatch = { items: out, vizToken };
  return batch;
};
