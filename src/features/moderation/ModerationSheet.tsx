/**
 * Denunciar e bloquear (App Store 1.2), num só sítio para o perfil e a jam.
 *
 * A folha abre com as acções possíveis: denunciar o conteúdo (a jam, a
 * playlist, a música), denunciar a pessoa e bloquear a pessoa. Denunciar
 * pede o motivo (e um texto opcional); bloquear pede confirmação. As
 * denúncias chegam aos administradores na hora e são vistas em 24 h; o
 * bloqueio desfaz a amizade e vale nos dois sentidos (sem perfil, sem jams).
 */
import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { BottomSheet, ConfirmDialog } from "@/ui";
import {
  blockUser,
  REPORT_REASONS,
  reportContent,
  useAfterBlock,
  type ReportReason,
  type ReportTarget,
} from "./api";

const M = "native.moderation";

export interface ModerationPerson {
  id: string;
  handle?: string | null;
  name?: string | null;
}

export interface ModerationSheetProps {
  visible: boolean;
  onClose: () => void;
  /** A pessoa (denunciar e bloquear). */
  person?: ModerationPerson | null;
  /** O que ela mostra: uma jam, uma playlist, uma música. */
  content?: ReportTarget | null;
  /** Depois de bloquear (ex.: sair do perfil). */
  onBlocked?: () => void;
}

type Step = { kind: "menu" } | { kind: "report"; target: ReportTarget } | { kind: "sent" };

const Row = ({ label, onPress, destructive }: { label: string; onPress: () => void; destructive?: boolean }) => {
  const { tokens, ink } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 52, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
    >
      <Text style={{ fontSize: 16, fontWeight: "500", color: destructive ? ink.destructive : tokens.foreground }}>
        {label}
      </Text>
    </Pressable>
  );
};

export const ModerationSheet = ({ visible, onClose, person, content, onBlocked }: ModerationSheetProps) => {
  const t = useT();
  const { tokens, ink } = useTheme();
  const afterBlock = useAfterBlock();
  const [step, setStep] = useState<Step>({ kind: "menu" });
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);

  // Fecha e volta ao princípio, para a próxima vez abrir no menu.
  const close = (): void => {
    setStep({ kind: "menu" });
    setReason(null);
    setDetails("");
    setFailed(false);
    setConfirmBlock(false);
    onClose();
  };

  const who = person?.handle ? `@${person.handle}` : (person?.name ?? "");

  const send = (target: ReportTarget): void => {
    if (!reason || pending) return;
    setPending(true);
    setFailed(false);
    reportContent(target, reason, details)
      .then(() => {
        haptics.success();
        setStep({ kind: "sent" });
      })
      .catch(() => setFailed(true))
      .finally(() => setPending(false));
  };

  const block = (): void => {
    if (!person || pending) return;
    setPending(true);
    setFailed(false);
    blockUser(person.id)
      .then(async () => {
        await afterBlock();
        close();
        onBlocked?.();
      })
      .catch(() => setFailed(true))
      .finally(() => setPending(false));
  };

  const title = (text: string) => (
    <Text accessibilityRole="header" style={{ color: tokens.foreground, fontSize: 17, fontWeight: "700" }}>
      {text}
    </Text>
  );

  return (
    <>
      <BottomSheet visible={visible && !confirmBlock} onClose={close}>
        <View style={{ paddingHorizontal: 20, paddingBottom: 12, gap: 6 }}>
          {step.kind === "menu" ? (
            <>
              {content ? (
                <Row
                  label={t(`${M}.report.${content.kind}`)}
                  onPress={() => setStep({ kind: "report", target: content })}
                />
              ) : null}
              {person ? (
                <Row
                  label={t(`${M}.reportPerson`, { who })}
                  onPress={() => setStep({ kind: "report", target: { kind: "user", id: person.id } })}
                />
              ) : null}
              {person ? (
                <Row destructive label={t(`${M}.blockPerson`, { who })} onPress={() => setConfirmBlock(true)} />
              ) : null}
              <Text style={{ color: tokens.mutedForeground, fontSize: 13, paddingTop: 6 }}>{t(`${M}.footnote`)}</Text>
            </>
          ) : null}

          {step.kind === "report" ? (
            <>
              {title(t(`${M}.reasonTitle`))}
              {REPORT_REASONS.map((r) => (
                <Pressable
                  key={r}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: reason === r }}
                  onPress={() => setReason(r)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 }}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      borderWidth: 2,
                      borderColor: reason === r ? tokens.primary : tokens.mutedForeground,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {reason === r ? (
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tokens.primary }} />
                    ) : null}
                  </View>
                  <Text style={{ color: tokens.foreground, fontSize: 15 }}>{t(`${M}.reasons.${r}`)}</Text>
                </Pressable>
              ))}
              <TextInput
                value={details}
                onChangeText={setDetails}
                placeholder={t(`${M}.detailsPlaceholder`)}
                placeholderTextColor={tokens.mutedForeground}
                multiline
                maxLength={2000}
                accessibilityLabel={t(`${M}.detailsPlaceholder`)}
                style={{
                  minHeight: 72,
                  borderWidth: 1,
                  borderColor: tokens.input,
                  borderRadius: RADIUS,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  color: tokens.foreground,
                  fontSize: 15,
                  textAlignVertical: "top",
                  marginTop: 6,
                }}
              />
              {failed ? <Text style={{ color: ink.destructive, fontSize: 14 }}>{t(`${M}.failed`)}</Text> : null}
              <Pressable
                accessibilityRole="button"
                disabled={!reason || pending}
                onPress={() => send(step.target)}
                style={({ pressed }) => ({
                  marginTop: 8,
                  minHeight: 46,
                  borderRadius: 999,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: tokens.primary,
                  opacity: !reason ? 0.4 : pressed ? 0.7 : 1,
                })}
              >
                {pending ? (
                  <ActivityIndicator color={tokens.primaryForeground} />
                ) : (
                  <Text style={{ color: tokens.primaryForeground, fontWeight: "700", fontSize: 15 }}>
                    {t(`${M}.send`)}
                  </Text>
                )}
              </Pressable>
            </>
          ) : null}

          {step.kind === "sent" ? (
            <>
              {title(t(`${M}.sentTitle`))}
              <Text style={{ color: tokens.mutedForeground, fontSize: 15 }}>{t(`${M}.sentBody`)}</Text>
              {person ? (
                <Row destructive label={t(`${M}.blockPerson`, { who })} onPress={() => setConfirmBlock(true)} />
              ) : null}
              <Row label={t("native.common.close")} onPress={close} />
            </>
          ) : null}
        </View>
      </BottomSheet>

      <ConfirmDialog
        visible={visible && confirmBlock}
        title={t(`${M}.blockTitle`, { who })}
        message={failed ? t(`${M}.failed`) : t(`${M}.blockMessage`)}
        confirmLabel={t(`${M}.block`)}
        destructive
        pending={pending}
        onConfirm={block}
        onCancel={() => setConfirmBlock(false)}
      />
    </>
  );
};
