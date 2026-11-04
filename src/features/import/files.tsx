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
import { Pressable, Text, View } from "react-native";
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
  NoticeBanner,
  PrimaryButton,
  ProgressBar,
  SettingsSection,
  useApiErrorMessage,
} from "@/features/settings/ui";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/provider";
import { ConfirmDialog, Icon } from "@/ui";
import { Reveal } from "@/ui/motion";
import { WaitHint } from "@/ui/page";
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

type StepState = "done" | "active" | "todo";

/**
 * A lista do que está a acontecer numa importação longa: escolhido, a
 * enviar (com a barra), na biblioteca. Uma espera nunca fica parada sem
 * explicação.
 */
const Step = ({ state, label, children }: { state: StepState; label: string; children?: React.ReactNode }) => {
  const { tokens } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: state === "done" ? 0 : 1.5,
          borderColor: state === "active" ? tokens.foreground : tokens.muted,
          backgroundColor: state === "done" ? tokens.foreground : "transparent",
        }}
      >
        {state === "done" ? <Icon name="check" size={14} color={tokens.background} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 8, paddingTop: 1 }}>
        <Text
          style={{
            color: state === "todo" ? tokens.mutedForeground : tokens.foreground,
            fontSize: 16,
            fontWeight: state === "active" ? "600" : "400",
          }}
        >
          {label}
        </Text>
        {children}
      </View>
    </View>
  );
};

/** Acção de texto (pasta, ignorar, tentar de novo). */
const TextAction = ({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) => {
  const { tokens } = useTheme();
  return (
    <Pressable accessibilityRole="button" hitSlop={10} disabled={disabled} onPress={onPress}>
      {({ pressed }) => (
        <Text
          style={{
            color: tokens.foreground,
            fontSize: 15,
            fontWeight: "600",
            opacity: disabled ? 0.45 : pressed ? 0.6 : 1,
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
};

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
      if (failed > 0) haptics.error();
      else haptics.success();
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
    <View style={{ gap: 28 }}>
      <View style={{ gap: 16 }}>
        <Text style={{ color: tokens.foreground, fontSize: 17, lineHeight: 23 }}>
          {t(`${SETTINGS_KEY}.dropzoneTitle`)}
        </Text>
        {/* Uma acção principal (ficheiros); a pasta é texto ao lado. Folder
            picks need a real primitive underneath (webkitdirectory on web,
            Directory.pickDirectoryAsync on native); where there is none the
            action disappears instead of erroring. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <PrimaryButton
            label={t(`${SETTINGS_KEY}.selectFiles`)}
            onPress={() => void chooseFiles()}
            disabled={busy}
          />
          {FOLDER_PICKER_AVAILABLE ? (
            <TextAction
              label={t(`${SETTINGS_KEY}.selectFolder`)}
              onPress={() => void chooseFolder()}
              disabled={busy}
            />
          ) : null}
        </View>
      </View>

      {busy ? (
        <Reveal>
          <View style={{ gap: 16 }}>
            <Step state="done" label={t("native.import.stepPicked")} />
            <Step
              state="active"
              label={
                progress
                  ? t(`${SETTINGS_KEY}.importingProgress`, {
                      current: progress.current,
                      total: progress.total,
                    })
                  : t(`${SETTINGS_KEY}.importInProgress`)
              }
            >
              <ProgressBar value={progress && progress.total > 0 ? progress.current / progress.total : 0} />
              {/* Um ficheiro sem perdas leva dezenas de segundos: a frase
                  muda para a espera nunca parecer presa. */}
              <WaitHint active style={{ alignItems: "flex-start", paddingVertical: 0 }} />
            </Step>
            <Step state="todo" label={t("native.import.stepLibrary")} />
          </View>
        </Reveal>
      ) : null}

      {notice ? (
        <Reveal distance={6}>
          <NoticeBanner kind={notice.kind} message={notice.text} />
        </Reveal>
      ) : null}

      {!busy && warnings.length > 0 ? (
        <SettingsSection title={t(`${SETTINGS_KEY}.incompleteImport`)}>
          {warnings.map((record, index) => (
            <View
              key={record.path}
              style={{
                paddingVertical: 14,
                gap: 10,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: tokens.border,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Icon name="alert-circle" size={16} color={ink.destructive} />
                <Text
                  numberOfLines={1}
                  style={{ color: tokens.foreground, fontSize: 16, fontWeight: "600", flex: 1 }}
                >
                  {record.path}
                </Text>
              </View>
              <Text style={{ color: tokens.mutedForeground, fontSize: 14, lineHeight: 19 }}>
                {t(`${SETTINGS_KEY}.incompleteImportDescription`, { path: record.path })}{" "}
                {t(`${SETTINGS_KEY}.reuploadFolderToRetry`)}
              </Text>
              <Text style={{ color: tokens.mutedForeground, fontSize: 13, fontWeight: "600" }}>
                {t(`${SETTINGS_KEY}.failedFiles`)}
              </Text>
              {record.status.failed.map((name) => (
                <View key={name} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Text numberOfLines={1} style={{ flex: 1, color: tokens.mutedForeground, fontSize: 14 }}>
                    {name}
                  </Text>
                  <TextAction
                    label={t(`${SETTINGS_KEY}.ignoreFile`)}
                    onPress={() => trackIgnore(record.path, name)}
                  />
                </View>
              ))}
              <View style={{ flexDirection: "row", gap: 20, flexWrap: "wrap", paddingTop: 4 }}>
                <TextAction label={t(`${SETTINGS_KEY}.retryImport`)} onPress={() => void chooseFolder()} />
                <TextAction
                  label={t(`${SETTINGS_KEY}.deleteWarning`)}
                  onPress={() => setDismissing(record.path)}
                />
              </View>
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
