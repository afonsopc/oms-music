/**
 * Import screen (settings > import): the user's own files, nothing else.
 *
 * On web and desktop a short line below the upload points to the separate
 * import page (`./elsewhere.web.tsx`); on iOS and Android `./elsewhere.tsx`
 * renders nothing, and that file is the only place the line exists. See
 * docs/app-store.md.
 */
import React from "react";
import { SettingsPage } from "@/features/settings/ui";
import { useT } from "@/i18n";
import ImportElsewhere from "./elsewhere";
import FilesImportTab from "./files";

const PAGE_KEY = "components.music.Settings.ImportPage";

export default function ImportScreen() {
  const t = useT();
  // Redesenho 2026-11-04: a moldura comum das definições (título, margem),
  // sem subtítulo; o título rola com o resto.
  return (
    <SettingsPage title={t(`${PAGE_KEY}.title`)}>
      <FilesImportTab />
      <ImportElsewhere />
    </SettingsPage>
  );
}
