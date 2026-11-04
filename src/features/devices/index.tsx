/**
 * Devices screen (FR-14, P2 addendum to the settings group): the sessions
 * signed in to this account, with a rename affordance on the CURRENT one.
 *
 * There is deliberately NO "sign out other device" button: the backend's
 * `DELETE /sessions/:id` always kills the CALLER regardless of the id, so a
 * revoke button would be a lie. The note row says so in plain language.
 */
import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useRenameSession, useSessions } from "@/api/queries/sessions";
import { useSessionStore } from "@/auth/session";
import { isApiError } from "@/domain/api";
import type { Session } from "@/domain/user";
import { PrimaryButton, SettingsPage, SettingsSection } from "@/features/settings/ui";
import { useLocale, useT } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { Skeleton } from "@/ui";
import { PageState } from "@/ui/page";

const MAX_NAME_LENGTH = 50;

/** Esqueleto das linhas (nome + data), já dentro da margem da página. */
const SessionsSkeleton = () => (
  <View style={{ gap: 4 }}>
    {[0, 1, 2, 3].map((i) => (
      <View key={i} style={{ height: 60, justifyContent: "center", gap: 8 }}>
        <Skeleton width={`${55 - i * 7}%`} height={14} />
        <Skeleton width="40%" height={11} />
      </View>
    ))}
  </View>
);

const SessionRow = ({
  session,
  isCurrent,
  first,
}: {
  session: Session;
  isCurrent: boolean;
  first: boolean;
}) => {
  const t = useT();
  const locale = useLocale();
  const { tokens, ink } = useTheme();
  const rename = useRenameSession();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.name);
  // Optimista: o nome novo aparece logo; volta atrás se o servidor recusar.
  const [shownName, setShownName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const name = draft.trim().slice(0, MAX_NAME_LENGTH);
    if (!name || name === session.name) {
      setEditing(false);
      return;
    }
    setError(null);
    setShownName(name);
    setEditing(false);
    rename.mutate(
      { id: session.id, name },
      {
        onSuccess: () => haptics.success(),
        onError: (e: unknown) => {
          haptics.error();
          setShownName(null);
          setEditing(true);
          // Error bodies are bare JSON strings; render them when short.
          setError(
            isApiError(e) && typeof e.body === "string" && e.body.length > 0 && e.body.length < 200
              ? e.body
              : t("native.devices.renameError"),
          );
        },
        onSettled: () => setShownName(null),
      },
    );
  };

  const lastUsed = t("native.devices.lastUsed", {
    date: formatDateTime(session.last_used_at, locale),
  });

  return (
    <View
      style={{
        paddingVertical: 12,
        gap: 10,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: tokens.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 36 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 16, fontWeight: "500" }}>
            {shownName ?? session.name}
          </Text>
          {isCurrent ? (
            <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 14 }}>
              {t("native.devices.thisDevice")}
            </Text>
          ) : null}
          <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 14 }}>
            {lastUsed}
          </Text>
        </View>
        {isCurrent && !editing ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => {
              setDraft(shownName ?? session.name);
              setEditing(true);
            }}
          >
            {({ pressed }) => (
              <Text
                style={{
                  color: tokens.mutedForeground,
                  fontSize: 14,
                  fontWeight: "600",
                  opacity: pressed ? 0.6 : 1,
                }}
              >
                {t("native.devices.rename")}
              </Text>
            )}
          </Pressable>
        ) : null}
      </View>

      {isCurrent && editing ? (
        <View style={{ gap: 10 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            maxLength={MAX_NAME_LENGTH}
            autoFocus
            placeholder={t("native.devices.namePlaceholder")}
            placeholderTextColor={tokens.mutedForeground}
            onSubmitEditing={submit}
            returnKeyType="done"
            style={{
              borderWidth: 1,
              borderColor: tokens.input,
              borderRadius: RADIUS,
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontSize: 16,
              color: tokens.foreground,
              backgroundColor: tokens.background,
            }}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
            <PrimaryButton compact label={t("native.devices.save")} onPress={submit} />
            <Pressable
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => {
                setEditing(false);
                setError(null);
              }}
            >
              <Text style={{ color: tokens.mutedForeground, fontSize: 14, fontWeight: "600" }}>
                {t("native.common.cancel")}
              </Text>
            </Pressable>
          </View>
          {error ? <Text style={{ color: ink.destructive, fontSize: 14 }}>{error}</Text> : null}
        </View>
      ) : null}
    </View>
  );
};

export default function DevicesScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const currentSessionId = useSessionStore((s) => s.session?.id ?? null);
  const sessions = useSessions();
  const list = sessions.data ?? [];
  // O aparelho actual primeiro; os outros pela ordem do servidor.
  const ordered = [
    ...list.filter((s) => s.id === currentSessionId),
    ...list.filter((s) => s.id !== currentSessionId),
  ];
  const settled = !sessions.isLoading && !sessions.isError && list.length > 0;

  return (
    <SettingsPage title={t("native.devices.title")}>
      {settled ? null : (
        <PageState
        loading={sessions.isLoading}
        error={sessions.isError ? sessions.error : null}
        empty={!sessions.isLoading && !sessions.isError && list.length === 0}
        emptyIcon="cast"
        emptyText={t("native.devices.empty")}
        onRetry={() => void sessions.refetch()}
        skeleton={<SessionsSkeleton />}
        />
      )}
      {settled ? (
        <SettingsSection>
          {ordered.map((session, index) => (
            <SessionRow
              key={session.id}
              session={session}
              isCurrent={session.id === currentSessionId}
              first={index === 0}
            />
          ))}
        </SettingsSection>
      ) : null}
      {settled ? (
        <Text style={{ color: tokens.mutedForeground, fontSize: 14, lineHeight: 19 }}>
          {t("native.devices.revokeNote")}
        </Text>
      ) : null}
    </SettingsPage>
  );
}
