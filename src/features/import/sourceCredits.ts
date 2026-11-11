/**
 * iOS and Android: no credit lines. The lyrics, artist photos, bios and
 * "similar artists" a person sees are what they put in their own library
 * (through their own import), so the native apps never name where an import
 * found them. The web and desktop version, which does, lives in
 * `./sourceCredits.web.ts` (Metro never bundles it into the native apps).
 * Keep this file free of service names (docs/app-store.md).
 */
export type SourceCreditKind = "lyrics" | "radio" | "artistAbout";

export const sourceCredit = (_kind: SourceCreditKind, _source?: string | null): string | null => null;
