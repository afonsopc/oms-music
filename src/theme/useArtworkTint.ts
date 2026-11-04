/**
 * O tom de uma capa (theme/tint) como hook: extrai a cor média uma vez por
 * chave (cache LRU do theme/accent), devolve o neutro enquanto não há cor e
 * nunca pinta a capa anterior com a cor da seguinte.
 */
import { useEffect, useState } from "react";
import { getCachedAccent, resolveAccent, type AccentKind } from "./accent";
import { useTheme } from "./provider";
import { ACCENT_FALLBACK, HERO_FALLBACK } from "./tokens";
import { neutralTint, tintFromAccent, type Tint } from "./tint";

type Variants = { light: string; dark: string };

/** A cor da capa (as duas variantes) ou null enquanto não se sabe. */
export const useArtworkAccent = (
  key: string | null,
  uri: string | null,
  kind: AccentKind = "song",
): Variants | null => {
  const [resolved, setResolved] = useState<{ key: string; variants: Variants } | null>(null);

  useEffect(() => {
    if (!key || !uri) return;
    let cancelled = false;
    void resolveAccent(kind, key, uri).then((variants) => {
      // A cor de recurso (o vermelho do FR-66) quer dizer "não deu para
      // ler a capa": aqui fica o neutro, nunca um tom inventado.
      if (variants.dark === ACCENT_FALLBACK || variants.dark === HERO_FALLBACK) return;
      if (!cancelled) setResolved({ key, variants });
    });
    return () => {
      cancelled = true;
    };
  }, [key, uri, kind]);

  if (!key || !uri) return null;
  if (resolved && resolved.key === key) return resolved.variants;
  return getCachedAccent(kind, key);
};

export const useArtworkTint = (key: string | null, uri: string | null): Tint => {
  const { scheme } = useTheme();
  const variants = useArtworkAccent(key, uri);
  return variants ? tintFromAccent(variants[scheme], scheme) : neutralTint(scheme);
};
