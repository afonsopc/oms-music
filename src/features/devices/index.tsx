/**
 * Devices screen (FR-14, P2 addendum to the settings group): the sessions
 * signed in to this account, with a rename affordance on the CURRENT one.
 *
 * There is deliberately NO "sign out other device" button: the backend's
 * `DELETE /sessions/:id` always kills the CALLER regardless of the id, so a
 * revoke button would be a lie. The note row says so in plain language.
 */
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRenameSession, useSessions } from "@/api/queries/sessions";
import { useSessionStore } from "@/auth/session";
import { isApiError } from "@/domain/api";
import type { Session } from "@/domain/user";
import { useContentBottomPadding } from "@/features/shell/metrics";
import { useLocale, useT } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { EmptyState, ErrorState, Icon, SongRowSkeleton } from "@/ui";

const MAX_NAME_LENGTH = 50;

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
  const { tokens } = useTheme();
  const rename = useRenameSession();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.name);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const name = draft.trim().slice(0, MAX_NAME_LENGTH);
    if (!name || name === session.name) {
      setEditing(false);
      return;
    }
    setError(null);
    rename.mutate(
      { id: session.id, name },
      {
        onSuccess: () => setEditing(false),
        onError: (e: unknown) => {
          // Error bodies are bare JSON strings; render them when short.
          setError(
            isApiError(e) && typeof e.body === "string" && e.body.length > 0 && e.body.length < 200
              ? e.body
              : t("native.devices.renameError"),
          );
        },
      },
    );
  };

  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 6,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: tokens.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}>
            {session.name}
          </Text>
          <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 12 }}>
            {t("native.devices.lastUsed", { date: formatDateTime(session.last_used_at, locale) })}
          </Text>
        </View>
        {isCurrent ? (
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: RADIUS,
              backgroundColor: tokens.secondary,
            }}
          >
            <Text style={{ color: tokens.secondaryForeground, fontSize: 11, fontWeight: "700" }}>
              {t("native.devices.thisDevice")}
            </Text>
          </View>
        ) : null}
      </View>

      {isCurrent && !editing ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setDraft(session.name);
            setEditing(true);
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Icon name="more-horizontal" size={14} color={tokens.mutedForeground} />
          <Text style={{ color: tokens.mutedForeground, fontSize: 12, fontWeight: "600" }}>
            {t("native.devices.rename")}
          </Text>
        </Pressable>
      ) : null}

      {isCurrent && editing ? (
        <View style={{ gap: 8 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            maxLength={MAX_NAME_LENGTH}
            autoFocus
            placeholder={t("native.devices.namePlaceholder")}
            placeholderTextColor={tokens.mutedForeground}
            onSubmitEditing={submit}
            style={{
              borderWidth: 1,
              borderColor: tokens.input,
              borderRadius: RADIUS,
              paddingHorizontal: 12,
              paddingVertical: 10,
              color: tokens.foreground,
              backgroundColor: tokens.background,
            }}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              disabled={rename.isPending}
              onPress={submit}
              style={({ pressed }) => ({
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: RADIUS,
                backgroundColor: tokens.primary,
                opacity: rename.isPending ? 0.6 : pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ color: tokens.primaryForeground, fontSize: 13, fontWeight: "700" }}>
                {t("native.devices.save")}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setEditing(false);
                setError(null);
              }}
              style={({ pressed }) => ({
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: RADIUS,
                borderWidth: 1,
                borderColor: tokens.border,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: tokens.foreground, fontSize: 13, fontWeight: "600" }}>
                {t("native.common.cancel")}
              </Text>
            </Pressable>
            {rename.isPending ? <ActivityIndicator color={tokens.foreground} /> : null}
          </View>
          {error ? (
            <Text style={{ color: tokens.destructive, fontSize: 12 }}>{error}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

export default function DevicesScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const bottomPadding = useContentBottomPadding();
  const currentSessionId = useSessionStore((s) => s.session?.id ?? null);
  const sessions = useSessions();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding, gap: 16 }}
    >
      <View style={{ gap: 6 }}>
        <Text style={{ color: tokens.foreground, fontSize: 28, fontWeight: "800" }}>
          {t("native.devices.title")}
        </Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 14, lineHeight: 20 }}>
          {t("native.devices.subtitle")}
        </Text>
      </View>

      {sessions.isLoading ? (
        <View style={{ gap: 8 }}>
          <SongRowSkeleton />
          <SongRowSkeleton />
          <SongRowSkeleton />
        </View>
      ) : sessions.isError ? (
        <ErrorState onRetry={() => void sessions.refetch()} />
      ) : (sessions.data ?? []).length === 0 ? (
        <EmptyState icon="cast" text={t("native.devices.empty")} />
      ) : (
        <View
          style={{
            borderWidth: 1,
            borderColor: tokens.border,
            borderRadius: RADIUS * 2,
            backgroundColor: tokens.card,
            overflow: "hidden",
          }}
        >
          {(sessions.data ?? []).map((session, index) => (
            <SessionRow
              key={session.id}
              session={session}
              isCurrent={session.id === currentSessionId}
              first={index === 0}
            />
          ))}
        </View>
      )}

      <Text style={{ color: tokens.mutedForeground, fontSize: 12, lineHeight: 18 }}>
        {t("native.devices.revokeNote")}
      </Text>
    </ScrollView>
  );
}
