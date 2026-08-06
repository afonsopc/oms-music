/**
 * Passkeys screen (FR-13), the account surface next to Devices: register a
 * passkey for the signed-in user, list the ones that exist, remove one.
 *
 * It mirrors what the web dashboard offers (add / list / delete) with one
 * addition: the nickname the API has always accepted
 * (`webauthn_credentials_controller.rb:51`) but the web UI never sends, so the
 * list can say "iPhone" instead of four identical rows.
 *
 * Two deliberate honesty choices:
 *
 *  - The Add button disappears when the platform cannot do passkeys, but the
 *    LIST does not. Passkeys registered on another device are still this
 *    account's, and being able to remove one from a device that cannot create
 *    one is exactly when you need to.
 *  - The footer says the password still works. The server has no "last
 *    passkey" guard, so a user really can delete every one of them; saying so
 *    is better than a confirm dialog that implies otherwise.
 *
 * Removing another device's passkey is genuinely possible here, unlike the
 * Devices screen's missing revoke button: DELETE /webauthn_credentials/:id
 * honours the id, while DELETE /sessions/:id ignores it and kills the caller.
 */
import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { classifyPasskeyFailure, passkeyErrorMessage } from "@/auth/passkeyErrors";
import { usePasskeysAvailable, type PasskeySummary } from "@/auth/passkeys";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { GhostButton, LabeledField, NoticeBanner, PrimaryButton, SettingsSection } from "@/features/settings/ui";
import { useLocale, useT } from "@/i18n";
import { formatDate, formatDateTime } from "@/lib/dates";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ConfirmDialog, EmptyState, ErrorState, Icon, SongRowSkeleton } from "@/ui";
import { useDeletePasskey, usePasskeys, useRegisterPasskey } from "./queries";

const MAX_NICKNAME_LENGTH = 40;

const PasskeyRow = ({
  passkey,
  first,
  onRemove,
}: {
  passkey: PasskeySummary;
  first: boolean;
  onRemove: () => void;
}) => {
  const t = useT();
  const locale = useLocale();
  const { tokens } = useTheme();

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: tokens.border,
      }}
    >
      <Icon name="circle-check" size={20} color={tokens.mutedForeground} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}>
          {passkey.nickname?.trim() || t("native.passkeys.unnamed")}
        </Text>
        <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 12 }}>
          {t("native.passkeys.created", { date: formatDate(passkey.created_at, locale) })}
        </Text>
        <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 12 }}>
          {passkey.last_used_at
            ? t("native.passkeys.lastUsed", {
                date: formatDateTime(passkey.last_used_at, locale),
              })
            : t("native.passkeys.neverUsed")}
        </Text>
      </View>
      <GhostButton compact label={t("native.passkeys.remove")} onPress={onRemove} />
    </View>
  );
};

export default function PasskeysScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const bottomPadding = useContentBottomPadding();
  const topPadding = useContentTopPadding();
  const available = usePasskeysAvailable();

  const passkeys = usePasskeys();
  const register = useRegisterPasskey();
  const remove = useDeletePasskey();

  const [nickname, setNickname] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PasskeySummary | null>(null);
  /** Seconds left on a server 429, so the button never says "wait" while enabled. */
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const parked = cooldown > 0;

  const add = (): void => {
    if (register.isPending || parked) return;
    setError(null);
    setNotice(null);
    register.mutate(nickname.trim() || undefined, {
      onSuccess: () => {
        setNickname("");
        setNotice(t("native.passkeys.added"));
      },
      onError: (e: unknown) => {
        // A dismissed sheet resolves to a null message here: no row, no shouting.
        const info = classifyPasskeyFailure(e);
        if (info.retryAfter) setCooldown(info.retryAfter);
        setError(passkeyErrorMessage(info, t));
      },
    });
  };

  const confirmRemoval = (): void => {
    const target = pendingRemoval;
    if (!target || remove.isPending) return;
    setError(null);
    setNotice(null);
    remove.mutate(target.id, {
      onSuccess: () => {
        setPendingRemoval(null);
        setNotice(t("native.passkeys.removed"));
      },
      onError: (e: unknown) => {
        setPendingRemoval(null);
        setError(passkeyErrorMessage(classifyPasskeyFailure(e), t));
      },
    });
  };

  const rows = passkeys.data ?? [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ padding: 16, paddingTop: topPadding, paddingBottom: bottomPadding, gap: 16 }}
    >
      <View style={{ gap: 6 }}>
        <Text style={{ color: tokens.foreground, fontSize: 28, fontWeight: "800" }}>
          {t("native.passkeys.title")}
        </Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 14, lineHeight: 20 }}>
          {t("native.passkeys.subtitle")}
        </Text>
      </View>

      {error ? <NoticeBanner kind="error" message={error} /> : null}
      {notice ? <NoticeBanner kind="success" message={notice} /> : null}

      {available === false ? (
        <NoticeBanner kind="info" message={t("native.passkeys.unavailable")} />
      ) : null}

      {available === true ? (
        <SettingsSection title={t("native.passkeys.addSection")}>
          <View style={{ padding: 16, gap: 12 }}>
            <LabeledField
              label={t("native.passkeys.nickname")}
              value={nickname}
              onChangeText={(value) => setNickname(value.slice(0, MAX_NICKNAME_LENGTH))}
              placeholder={t("native.passkeys.nicknamePlaceholder")}
              autoCapitalize="sentences"
            />
            <PrimaryButton
              label={
                parked
                  ? t("native.auth.passkey.retryIn", { seconds: cooldown })
                  : t("native.passkeys.add")
              }
              onPress={add}
              busy={register.isPending}
              disabled={register.isPending || parked}
            />
          </View>
        </SettingsSection>
      ) : null}

      {passkeys.isLoading ? (
        <View style={{ gap: 8 }}>
          <SongRowSkeleton />
          <SongRowSkeleton />
        </View>
      ) : passkeys.isError ? (
        <ErrorState onRetry={() => void passkeys.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon="circle-check" text={t("native.passkeys.empty")} />
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
          {rows.map((passkey, index) => (
            <PasskeyRow
              key={passkey.id}
              passkey={passkey}
              first={index === 0}
              onRemove={() => setPendingRemoval(passkey)}
            />
          ))}
        </View>
      )}

      <Text style={{ color: tokens.mutedForeground, fontSize: 12, lineHeight: 18 }}>
        {t("native.passkeys.passwordNote")}
      </Text>

      <ConfirmDialog
        visible={pendingRemoval !== null}
        title={t("native.passkeys.removeTitle")}
        message={t("native.passkeys.removeMessage", {
          name: pendingRemoval?.nickname?.trim() || t("native.passkeys.unnamed"),
        })}
        confirmLabel={t("native.passkeys.remove")}
        destructive
        pending={remove.isPending}
        onConfirm={confirmRemoval}
        onCancel={() => setPendingRemoval(null)}
      />
    </ScrollView>
  );
}
