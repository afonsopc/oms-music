/**
 * Files tab (FR-99 upload, FR-100 folder resume).
 *
 * `POST /songs/import` is SYNCHRONOUS multipart, one request per file, and a
 * lossless master can take tens of seconds (the endpoint module already sets
 * a long timeout). Web etiquette kept: at most 3 uploads in flight, a
 * current/total counter, aggregated result copy instead of per-file toasts,
 * and a global busy flag so a second import surface refuses to start.
 *
 * Folder picks additionally write a resume tracker: a retry skips the files
 * that already landed, failures surface as an "incomplete import" card with
 * retry / ignore / dismiss.
 */
import React, { useState } from "react";
import { Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { oms, toFileInput } from "@/api/oms";
import { invalidationTargets } from "@/api/queryKeys";
import {
  FOLDER_PICKER_AVAILABLE,
  pickAudioFiles,
  pickAudioFolder,
  type PickedAudio,
} from "@/features/settings/pickers";
import {
  GhostButton,
  NoticeBanner,
  PrimaryButton,
  ProgressBar,
  SettingsSection,
  useApiErrorMessage,
} from "@/features/settings/ui";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ConfirmDialog, Icon } from "@/ui";
import { fileKey, getRecord, incompleteRecords, pendingFiles } from "./folderTracker";
import {
  forgetFolder,
  getTrackerRecords,
  trackFailure,
  trackIgnore,
  trackSuccess,
  useTrackerRecords,
} from "./folderTrackerStore";
import { setImportBusy, useImportBusy } from "./importBusy";

const SETTINGS_KEY = "components.music.Settings";
const CONCURRENCY = 3;

interface Progress {
  current: number;
  total: number;
}

export default function FilesImportTab() {
  const t = useT();
  const { tokens, ink } = useTheme();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const busy = useImportBusy();
  const records = useTrackerRecords();

  const [progress, setProgress] = useState<Progress | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(
    null,
  );
  const [dismissing, setDismissing] = useState<string | null>(null);

  const warnings = incompleteRecords(records);

  const invalidateLibrary = (): void => {
    for (const key of invalidationTargets.libraryLists) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const runImport = async (files: PickedAudio[], folderPath: string | null): Promise<void> => {
    if (files.length === 0) {
      setNotice({ kind: "error", text: t(`${SETTINGS_KEY}.noAudioFilesSelected`) });
      return;
    }

    const toImport = folderPath
      ? pendingFiles(getRecord(getTrackerRecords(), folderPath), files)
      : files;
    if (folderPath && toImport.length === 0) {
      setNotice({ kind: "info", text: t(`${SETTINGS_KEY}.allFilesAlreadyImported`) });
      return;
    }

    setImportBusy(true);
    setNotice(null);
    setProgress({ current: 0, total: toImport.length });

    let completed = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      for (let index = 0; index < toImport.length; index += CONCURRENCY) {
        const batch = toImport.slice(index, index + CONCURRENCY);
        await Promise.all(
          batch.map(async (file) => {
            try {
              // toFileInput keeps the bytes on web (a real browser File,
              // pickers.web.ts) and hands the { uri, name, type } descriptor
              // to RN's FormData on native. Synchronous multipart import:
              // lossless files take tens of seconds (the SDK allows 300s).
              await oms().music.songs.import(toFileInput(file));
              succeeded += 1;
              if (folderPath) trackSuccess(folderPath, fileKey(file));
            } catch {
              failed += 1;
              if (folderPath) trackFailure(folderPath, fileKey(file));
            } finally {
              completed += 1;
              setProgress({ current: completed, total: toImport.length });
            }
          }),
        );
      }

      if (folderPath && failed === 0) forgetFolder(folderPath);

      if (succeeded > 0) invalidateLibrary();
      if (failed > 0) {
        setNotice({
          kind: "error",
          text: t(`${SETTINGS_KEY}.someFilesFailedToImport`, {
            failed,
            total: toImport.length,
          }),
        });
      } else {
        setNotice({
          kind: "success",
          text: t(`${SETTINGS_KEY}.songsImportedSuccessfully`, { count: succeeded }),
        });
      }
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setImportBusy(false);
      setProgress(null);
    }
  };

  const chooseFiles = async (): Promise<void> => {
    try {
      const picked = await pickAudioFiles();
      await runImport(picked, null);
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    }
  };

  const chooseFolder = async (): Promise<void> => {
    try {
      const folder = await pickAudioFolder();
      if (!folder) return;
      await runImport(folder.files, folder.path);
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    }
  };

  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title={t(`${SETTINGS_KEY}.importMusic`)}>
        <View style={{ padding: 16, gap: 12 }}>
          <Text style={{ color: tokens.foreground, fontSize: 15, fontWeight: "700" }}>
            {t(`${SETTINGS_KEY}.dropzoneTitle`)}
          </Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 13, lineHeight: 19 }}>
            {t(`${SETTINGS_KEY}.dropzoneDescription`)}
          </Text>
          {/* Stacked, not side by side: "Selecionar Ficheiros" wrapped to two
              lines at half a phone's width while its sibling stayed on one,
              and a pair of buttons at two different heights reads broken. */}
          <View style={{ gap: 10 }}>
            <PrimaryButton
              label={t(`${SETTINGS_KEY}.selectFiles`)}
              onPress={() => void chooseFiles()}
              disabled={busy}
              compact
            />
            {/* Folder picks need a real primitive underneath (webkitdirectory
                on web, Directory.pickDirectoryAsync on native); where there
                is none the button disappears instead of erroring - loose
                multi-file picks cover the same ground. */}
            {FOLDER_PICKER_AVAILABLE ? (
              <GhostButton
                label={t(`${SETTINGS_KEY}.selectFolder`)}
                onPress={() => void chooseFolder()}
                disabled={busy}
                compact
              />
            ) : null}
          </View>

          {busy && progress ? (
            <View style={{ gap: 6 }}>
              <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
                {t(`${SETTINGS_KEY}.importingProgress`, {
                  current: progress.current,
                  total: progress.total,
                })}
              </Text>
              <ProgressBar
                value={progress.total > 0 ? progress.current / progress.total : 0}
              />
            </View>
          ) : null}

          {busy && !progress ? (
            <NoticeBanner kind="info" message={t(`${SETTINGS_KEY}.importInProgress`)} />
          ) : null}
        </View>
      </SettingsSection>

      {notice ? <NoticeBanner kind={notice.kind} message={notice.text} /> : null}

      {!busy && warnings.length > 0 ? (
        <SettingsSection title={t(`${SETTINGS_KEY}.incompleteImport`)}>
          {warnings.map((record, index) => (
            <View
              key={record.path}
              style={{
                padding: 16,
                gap: 10,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: tokens.border,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Icon name="alert-circle" size={16} color={ink.destructive} />
                <Text style={{ color: tokens.foreground, fontSize: 14, fontWeight: "700", flex: 1 }}>
                  {record.path}
                </Text>
              </View>
              <Text style={{ color: tokens.mutedForeground, fontSize: 12, lineHeight: 18 }}>
                {t(`${SETTINGS_KEY}.incompleteImportDescription`, { path: record.path })}
              </Text>
              <Text style={{ color: tokens.mutedForeground, fontSize: 12, fontWeight: "700" }}>
                {t(`${SETTINGS_KEY}.failedFiles`)}
              </Text>
              {record.status.failed.map((name) => (
                <View
                  key={name}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    borderWidth: 1,
                    borderColor: tokens.border,
                    borderRadius: RADIUS,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{ flex: 1, color: tokens.mutedForeground, fontSize: 12 }}
                  >
                    {name}
                  </Text>
                  <GhostButton
                    label={t(`${SETTINGS_KEY}.ignoreFile`)}
                    compact
                    onPress={() => trackIgnore(record.path, name)}
                  />
                </View>
              ))}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <GhostButton
                  label={t(`${SETTINGS_KEY}.retryImport`)}
                  compact
                  onPress={() => void chooseFolder()}
                />
                <GhostButton
                  label={t(`${SETTINGS_KEY}.deleteWarning`)}
                  compact
                  onPress={() => setDismissing(record.path)}
                />
              </View>
              <Text style={{ color: tokens.mutedForeground, fontSize: 11 }}>
                {t(`${SETTINGS_KEY}.reuploadFolderToRetry`)}
              </Text>
            </View>
          ))}
        </SettingsSection>
      ) : null}

      <ConfirmDialog
        visible={dismissing !== null}
        title={t(`${SETTINGS_KEY}.deleteWarningTitle`)}
        message={`${t(`${SETTINGS_KEY}.deleteWarningConfirmationLine1`, {
          path: dismissing ?? "",
        })} ${t(`${SETTINGS_KEY}.deleteWarningConfirmationLine2`)}`}
        confirmLabel={t(`${SETTINGS_KEY}.deleteWarning`)}
        destructive
        onConfirm={() => {
          if (dismissing) forgetFolder(dismissing);
          setDismissing(null);
        }}
        onCancel={() => setDismissing(null)}
      />
    </View>
  );
}
