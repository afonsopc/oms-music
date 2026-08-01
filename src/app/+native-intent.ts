/**
 * Deep-link entry point (FR-20): incoming system URLs (omsmusic:// scheme,
 * Android https intent filter) run through lib/deepLinks.ts and land on the
 * mapped native route. Non-music URLs return null so the router's default
 * handling applies (dev client URLs, plain route paths).
 */
import { routeForDeepLinkUrl } from "@/features/shell/deepLinkRoute";

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  try {
    return routeForDeepLinkUrl(path);
  } catch {
    // Never crash the app over a malformed URL.
    return null;
  }
}
