/**
 * Jam panel (screen 22, FR-113/117/118): the whole jam surface.
 *
 * Two states:
 *  - not in a jam: what a jam is, "Start a Jam", and the joinable list from
 *    `GET /jams` (jams containing at least one accepted friend - exactly the
 *    join authorization, so the list never shows a jam that would refuse);
 *  - in a jam: the propose hint for members, the rules (host-editable, read
 *    only for members), what is up next, the member list, the invite list
 *    (accepted friends not already in the jam) and leave / end.
 *
 * There is NO host handoff: a host ending the jam ends it for everyone, so
 * that button is confirmed, and NO kick affordance exists server-side.
 */
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useJams } from "@/api/queries/jams";
import { useRelationships } from "@/api/queries/relationships";
import { acceptedFriends } from "@/api/endpoints/relationships";
import { avatarUrl } from "@/api/mediaUrl";
import { useSessionStore } from "@/auth/session";
import type { UserId } from "@/domain/ids";
import type { Jam } from "@/domain/jam";
import { useContentBottomPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { jamCreate, jamEnd, jamInvite, jamJoin, jamLeave, jamUpdateRules } from "@/jam/channel";
import { selectIsHost, useJamStore } from "@/jam/store";
import { artistNamesLine } from "@/social/display";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ArtworkImage, ConfirmDialog, EmptyState, Icon } from "@/ui";

const PANEL = "components.music.JamPanel";

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const RulePicker = <T extends string>({
  label,
  value,
  options,
  editable,
  onPick,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  editable: boolean;
  onPick: (value: T) => void;
}) => {
  const { tokens } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: tokens.mutedForeground, fontSize: 12, fontWeight: "600" }}>
        {label}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {options
          .filter((option) => editable || option.value === value)
          .map((option) => {
            const selected = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                disabled={!editable}
                onPress={() => onPick(option.value)}
                style={({ pressed }) => ({
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? tokens.primary : tokens.border,
                  backgroundColor: selected ? tokens.primary : "transparent",
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <Text
                  style={{
                    color: selected ? tokens.primaryForeground : tokens.foreground,
                    fontSize: 12,
                    fontWeight: "600",
                  }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
      </View>
    </View>
  );
};

const JamRules = ({ jam, isHost }: { jam: Jam; isHost: boolean }) => {
  const t = useT();
  const { tokens } = useTheme();
  return (
    <View
      style={{
        gap: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: tokens.border,
        borderRadius: RADIUS,
      }}
    >
      <Text style={{ color: tokens.foreground, fontSize: 14, fontWeight: "700" }}>
        {t(`${PANEL}.rules`)}
      </Text>
      <RulePicker
        label={t(`${PANEL}.ruleQueue`)}
        value={jam.queue_mode}
        editable={isHost}
        onPick={(queue_mode) => void jamUpdateRules({ queue_mode })}
        options={[
          { value: "everyone", label: t(`${PANEL}.queueEveryone`) },
          { value: "host", label: t(`${PANEL}.queueHost`) },
        ]}
      />
      <RulePicker
        label={t(`${PANEL}.ruleSkip`)}
        value={jam.skip_mode}
        editable={isHost}
        onPick={(skip_mode) => void jamUpdateRules({ skip_mode })}
        options={[
          { value: "majority", label: t(`${PANEL}.skipMajority`) },
          { value: "anyone", label: t(`${PANEL}.skipAnyone`) },
          { value: "host", label: t(`${PANEL}.skipHost`) },
        ]}
      />
    </View>
  );
};

// ---------------------------------------------------------------------------
// Up next (members only: the host reads their own queue in the Queue screen)
// ---------------------------------------------------------------------------

const JamUpcoming = () => {
  const t = useT();
  const { tokens } = useTheme();
  const upcoming = useJamStore((s) => s.state?.upcoming ?? null);
  const isHost = useJamStore(selectIsHost);
  if (isHost || !upcoming || upcoming.length === 0) return null;

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: tokens.mutedForeground, fontSize: 13, fontWeight: "600" }}>
        {t(`${PANEL}.upNext`)}
      </Text>
      {upcoming.map((entry, index) => (
        <View
          key={`${entry.id}-${index}`}
          style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
        >
          <ArtworkImage uri={entry.artwork_url} size={28} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 12 }}>
              {entry.title}
            </Text>
            <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 11 }}>
              {artistNamesLine(entry.artist_names)}
              {entry.proposer
                ? `  ${t(`${PANEL}.pickedBy`, { handle: entry.proposer.handle })}`
                : ""}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

const PrimaryButton = ({
  label,
  onPress,
  destructive = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        paddingVertical: 12,
        borderRadius: RADIUS,
        backgroundColor: destructive ? tokens.destructive : tokens.primary,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={{
          color: destructive ? tokens.destructiveForeground : tokens.primaryForeground,
          fontSize: 14,
          fontWeight: "700",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
};

const PersonRow = ({
  userId,
  name,
  trailing,
}: {
  userId: UserId;
  name: string;
  trailing?: React.ReactNode;
}) => {
  const { tokens } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <ArtworkImage uri={avatarUrl(userId)} size={32} shape="circle" />
      <Text numberOfLines={1} style={{ flex: 1, color: tokens.foreground, fontSize: 14 }}>
        {name}
      </Text>
      {trailing}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function JamScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const bottomPadding = useContentBottomPadding();
  const myId = useSessionStore((s) => s.user?.id ?? null);
  const jam = useJamStore((s) => s.jam);
  const isHost = useJamStore(selectIsHost);
  const [invited, setInvited] = useState<readonly UserId[]>([]);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false);

  // The joinable list is only fetched while we are NOT already in a jam.
  const jamsQuery = useJams(!jam);
  const relationships = useRelationships(!!jam);

  const friends = useMemo(
    () => (myId ? acceptedFriends(relationships.data ?? [], myId) : []),
    [relationships.data, myId],
  );
  const memberIds = useMemo(() => new Set((jam?.members ?? []).map((m) => m.id)), [jam]);
  const invitable = friends.filter((friend) => !memberIds.has(friend.id));
  const joinable = (jamsQuery.data?.joinable ?? []).filter((entry) => entry.id !== jam?.id);

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding, gap: 16 }}
    >
      <Text style={{ color: tokens.foreground, fontSize: 28, fontWeight: "800" }}>
        {t(`${PANEL}.title`)}
      </Text>

      {!jam ? (
        <>
          <Text style={{ color: tokens.mutedForeground, fontSize: 14, lineHeight: 20 }}>
            {t(`${PANEL}.description`)}
          </Text>
          <PrimaryButton
            label={t(`${PANEL}.startJam`)}
            disabled={busy}
            onPress={() => void run(() => jamCreate())}
          />
          {joinable.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: tokens.mutedForeground, fontSize: 13, fontWeight: "600" }}>
                {t(`${PANEL}.joinableJams`)}
              </Text>
              {joinable.map((entry) => {
                const host = entry.members.find((member) => member.is_host);
                return (
                  <View
                    key={entry.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      padding: 10,
                      borderWidth: 1,
                      borderColor: tokens.border,
                      borderRadius: RADIUS,
                    }}
                  >
                    <ArtworkImage uri={avatarUrl(entry.host_id)} size={32} shape="circle" />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        numberOfLines={1}
                        style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600" }}
                      >
                        {t(`${PANEL}.hostsJam`, {
                          handle: host?.name || host?.handle || "?",
                        })}
                      </Text>
                      <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
                        {t(`${PANEL}.membersCount`, { count: entry.members.length })}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void run(() => jamJoin(entry.id))}
                      style={({ pressed }) => ({
                        paddingHorizontal: 14,
                        paddingVertical: 7,
                        borderRadius: RADIUS,
                        backgroundColor: tokens.primary,
                        opacity: busy ? 0.5 : pressed ? 0.85 : 1,
                      })}
                    >
                      <Text
                        style={{
                          color: tokens.primaryForeground,
                          fontSize: 12,
                          fontWeight: "700",
                        }}
                      >
                        {t(`${PANEL}.join`)}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : jamsQuery.isLoading ? null : (
            <EmptyState icon="users" text={t("native.jam.noJoinable")} />
          )}
        </>
      ) : (
        <>
          {!isHost && jam.queue_mode === "everyone" ? (
            <View
              style={{
                flexDirection: "row",
                gap: 8,
                padding: 10,
                borderRadius: RADIUS,
                backgroundColor: tokens.secondary,
              }}
            >
              <Icon name="sparkles" size={14} color={tokens.secondaryForeground} />
              <Text
                style={{
                  flex: 1,
                  color: tokens.secondaryForeground,
                  fontSize: 12,
                  lineHeight: 17,
                }}
              >
                {t(`${PANEL}.proposeHint`)}
              </Text>
            </View>
          ) : null}

          <JamRules jam={jam} isHost={isHost} />
          <JamUpcoming />

          <View style={{ gap: 10 }}>
            <Text style={{ color: tokens.mutedForeground, fontSize: 13, fontWeight: "600" }}>
              {t(`${PANEL}.membersCount`, { count: jam.members.length })}
            </Text>
            {jam.members.map((member) => (
              <PersonRow
                key={member.id}
                userId={member.id}
                name={`${member.name || member.handle}${
                  member.id === myId ? ` ${t(`${PANEL}.you`)}` : ""
                }`}
                trailing={
                  member.is_host ? (
                    <View
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: 999,
                        backgroundColor: tokens.secondary,
                      }}
                    >
                      <Text
                        style={{
                          color: tokens.secondaryForeground,
                          fontSize: 10,
                          fontWeight: "700",
                        }}
                      >
                        {t("native.jam.hostBadge")}
                      </Text>
                    </View>
                  ) : null
                }
              />
            ))}
          </View>

          <View style={{ gap: 10 }}>
            <Text style={{ color: tokens.mutedForeground, fontSize: 13, fontWeight: "600" }}>
              {t(`${PANEL}.inviteFriends`)}
            </Text>
            {invitable.length === 0 ? (
              <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
                {t("native.jam.noFriends")}
              </Text>
            ) : (
              invitable.map((friend) => {
                const sent = invited.includes(friend.id);
                return (
                  <PersonRow
                    key={friend.id}
                    userId={friend.id}
                    name={friend.name || friend.handle}
                    trailing={
                      <Pressable
                        accessibilityRole="button"
                        disabled={sent}
                        onPress={() => {
                          void jamInvite(friend.id).then((ok) => {
                            if (ok) setInvited((prev) => [...prev, friend.id]);
                          });
                        }}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: RADIUS,
                          backgroundColor: tokens.secondary,
                          opacity: sent ? 0.5 : pressed ? 0.8 : 1,
                        })}
                      >
                        <Icon name="plus" size={12} color={tokens.secondaryForeground} />
                        <Text
                          style={{
                            color: tokens.secondaryForeground,
                            fontSize: 12,
                            fontWeight: "600",
                          }}
                        >
                          {t(sent ? `${PANEL}.invited` : `${PANEL}.invite`)}
                        </Text>
                      </Pressable>
                    }
                  />
                );
              })
            )}
          </View>

          <PrimaryButton
            destructive
            disabled={busy}
            label={t(isHost ? `${PANEL}.endJam` : `${PANEL}.leaveJam`)}
            onPress={() => {
              if (isHost) setConfirmEnd(true);
              else void run(() => jamLeave());
            }}
          />
        </>
      )}

      <ConfirmDialog
        visible={confirmEnd}
        destructive
        title={t("native.jam.endConfirmTitle")}
        message={t("native.jam.endConfirmBody")}
        confirmLabel={t("native.jam.endConfirm")}
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => {
          setConfirmEnd(false);
          void run(() => jamEnd());
        }}
      />
    </ScrollView>
  );
}
