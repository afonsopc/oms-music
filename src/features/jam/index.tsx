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
 *
 * Redesenho 2026-11-04 (docs/redesenho.md, "O padrao"): o cabecalho comum,
 * rotulos de seccao, linhas finas (ListRow) para pessoas, jams e musicas,
 * as regras com as palavras sublinhadas do FilterPills em vez de pilulas,
 * uma so accao principal ("Comecar uma jam"), sair/terminar como linha
 * vermelha discreta. Convidar e optimista: muda no toque e volta se falhar.
 */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useJams } from "@/api/queries/jams";
import { acceptedFriends, useRelationships } from "@/api/queries/relationships";
import { avatarUrl } from "@/api/mediaUrl";
import { useSessionStore } from "@/auth/session";
import type { UserId } from "@/domain/ids";
import type { Jam } from "@/domain/jam";
import type { ReportTarget } from "@/features/moderation/api";
import { ModerationSheet, type ModerationPerson } from "@/features/moderation/ModerationSheet";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { jamCreate, jamEnd, jamInvite, jamJoin, jamLeave, jamUpdateRules } from "@/jam/channel";
import { jamStore, selectIsHost, useJamStore } from "@/jam/store";
import { artistNamesLine } from "@/social/display";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, ConfirmDialog, FilterPills, Icon } from "@/ui";
import { PressableScale } from "@/ui/motion";
import {
  ListRow,
  ListSkeleton,
  PageHeader,
  PageState,
  pageType,
  SectionLabel,
  TextButton,
  useGutter,
} from "@/ui/page";

/** Quem (e o quê) a folha de denunciar/bloquear tem à frente. */
type Moderate = { person: ModerationPerson | null; content: ReportTarget | null };

const PANEL = "components.music.JamPanel";
/** A fila da jam vem do servidor; mostrar mais do que isto nao ajuda ninguem. */
const UPCOMING_SHOWN = 20;

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
  const gutter = useGutter();
  // Quem nao manda ve a regra, nao um seletor desligado.
  if (!editable) {
    return (
      <ListRow title={label} meta={options.find((option) => option.value === value)?.label ?? null} />
    );
  }
  return (
    <View style={{ gap: 4, paddingTop: 8 }}>
      <Text style={[pageType.meta, { color: tokens.mutedForeground, paddingHorizontal: gutter }]}>
        {label}
      </Text>
      <FilterPills
        pills={options.map((option) => ({ key: option.value, label: option.label }))}
        activeKey={value}
        contentPaddingHorizontal={gutter}
        onChange={(key) => onPick(key as T)}
      />
    </View>
  );
};

const JamRules = ({ jam, isHost }: { jam: Jam; isHost: boolean }) => {
  const t = useT();
  return (
    <View>
      <SectionLabel title={t(`${PANEL}.rules`)} />
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

const JamUpcoming = ({ onModerate }: { onModerate: (target: Moderate) => void }) => {
  const t = useT();
  const upcoming = useJamStore((s) => s.state?.upcoming ?? null);
  const isHost = useJamStore(selectIsHost);
  const myId = useSessionStore((s) => s.user?.id ?? null);
  if (isHost || !upcoming || upcoming.length === 0) return null;
  const shown = upcoming.slice(0, UPCOMING_SHOWN);

  return (
    <View>
      <SectionLabel title={t(`${PANEL}.upNext`)} />
      {shown.map((entry, index) => (
        <ListRow
          key={`${entry.id}-${index}`}
          title={entry.title}
          meta={`${artistNamesLine(entry.artist_names)}${
            entry.proposer ? `  ${t(`${PANEL}.pickedBy`, { handle: entry.proposer.handle })}` : ""
          }`}
          leading={<ArtworkImage uri={entry.artwork_url} size={44} />}
          order={index < 10 ? index : undefined}
          last={index === shown.length - 1}
          // Uma música de outra pessoa: tocar abre denunciar/bloquear (1.2).
          onPress={
            entry.proposer && entry.proposer.id !== myId
              ? () =>
                  onModerate({
                    person: entry.proposer,
                    content: { kind: "song", id: entry.id, label: entry.title },
                  })
              : undefined
          }
        />
      ))}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/** `embedded`: montado numa folha (features/jam/sheet), nao como ecra do
 *  shell - a folha ja trata da area segura e das margens, por isso os
 *  espacamentos do shell (que contam com a ilha dinamica e a barra de tabs)
 *  sairiam a dobrar. A rota nao passa prop nenhuma, logo o default vale. */
export default function JamScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useT();
  const { tokens } = useTheme();
  const gutter = useGutter();
  const shellBottomPadding = useContentBottomPadding();
  const shellTopPadding = useContentTopPadding();
  const bottomPadding = embedded ? 24 : shellBottomPadding;
  const topPadding = embedded ? 4 : shellTopPadding;
  const myId = useSessionStore((s) => s.user?.id ?? null);
  const jam = useJamStore((s) => s.jam);
  const isHost = useJamStore(selectIsHost);
  const [invited, setInvited] = useState<readonly UserId[]>([]);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [moderate, setModerate] = useState<Moderate | null>(null);

  // The joinable list is only fetched while we are NOT already in a jam.
  const jamsQuery = useJams(!jam);
  // Friends are fetched EITHER WAY. Gating this on `!!jam` meant the invite
  // list only existed once a jam did, so the jam view inside the player -
  // which is where you are when the thought "let me get someone in on this"
  // occurs - showed a description and a button and no people at all (owner
  // report 2026-08-16, point 19).
  const relationships = useRelationships();

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

  /**
   * Inviting someone IMPLIES starting the jam. Before, the invite list only
   * existed once a jam did, so wanting to listen with a friend meant reading
   * a paragraph, pressing "Começar jam", and only then meeting the people -
   * two steps for one intention. The jam is created on demand and the invite
   * follows it; an existing jam skips straight to the invite.
   *
   * Optimista: "Convidado" aparece no toque e volta atras se falhar.
   */
  const inviteFriend = (friendId: UserId): void => {
    haptics.success();
    setInvited((prev) => [...prev, friendId]);
    const undo = (): void => {
      haptics.error();
      setInvited((prev) => prev.filter((id) => id !== friendId));
    };
    void run(async () => {
      if (!jamStore.getState().jam && !(await jamCreate())) return undo();
      if (!(await jamInvite(friendId))) undo();
    });
  };

  const inviteList = (
    <View>
      <SectionLabel title={t(`${PANEL}.inviteFriends`)} />
      {relationships.isPending ? (
        <ListSkeleton rows={3} round />
      ) : invitable.length === 0 ? (
        <Text style={[pageType.meta, { color: tokens.mutedForeground, paddingHorizontal: gutter }]}>
          {t("native.jam.noFriends")}
        </Text>
      ) : (
        invitable.map((friend, index) => {
          const sent = invited.includes(friend.id);
          return (
            <ListRow
              key={friend.id}
              title={friend.name || friend.handle}
              leading={<ArtworkImage uri={avatarUrl(friend.id)} size={40} shape="circle" />}
              order={index < 10 ? index : undefined}
              last={index === invitable.length - 1}
              trailing={
                sent ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Icon name="check" size={16} color={tokens.mutedForeground} />
                    <Text style={[pageType.meta, { color: tokens.mutedForeground }]}>
                      {t(`${PANEL}.invited`)}
                    </Text>
                  </View>
                ) : (
                  <TextButton
                    label={t(`${PANEL}.invite`)}
                    icon="plus"
                    onPress={() => inviteFriend(friend.id)}
                  />
                )
              }
            />
          );
        })
      )}
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: embedded ? "transparent" : tokens.background }}
      contentContainerStyle={{ paddingTop: topPadding, paddingBottom: bottomPadding }}
    >
      <PageHeader title={t(`${PANEL}.title`)} />

      {!jam ? (
        <>
          <Text
            style={[
              pageType.body,
              { color: tokens.mutedForeground, paddingHorizontal: gutter, marginTop: 8 },
            ]}
          >
            {t(`${PANEL}.description`)}
          </Text>
          <View style={{ paddingHorizontal: gutter, marginTop: 20 }}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t(`${PANEL}.startJam`)}
              disabled={busy}
              onPress={() => {
                haptics.tap();
                void run(() => jamCreate());
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                height: 52,
                paddingHorizontal: 28,
                borderRadius: 26,
                alignSelf: "flex-start",
                backgroundColor: tokens.primary,
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? (
                <ActivityIndicator color={tokens.primaryForeground} />
              ) : (
                <Icon name="users" size={18} color={tokens.primaryForeground} />
              )}
              <Text style={{ color: tokens.primaryForeground, fontSize: 16, fontWeight: "700" }}>
                {t(`${PANEL}.startJam`)}
              </Text>
            </PressableScale>
          </View>

          {/* The people, before the jam exists: inviting one starts it. */}
          {inviteList}

          <SectionLabel title={t(`${PANEL}.joinableJams`)} />
          {joinable.length > 0 ? (
            joinable.map((entry, index) => {
              const host = entry.members.find((member) => member.is_host);
              return (
                <ListRow
                  key={entry.id}
                  title={t(`${PANEL}.hostsJam`, { handle: host?.name || host?.handle || "?" })}
                  meta={t(`${PANEL}.membersCount`, { count: entry.members.length })}
                  leading={<ArtworkImage uri={avatarUrl(entry.host_id)} size={40} shape="circle" />}
                  order={index}
                  last={index === joinable.length - 1}
                  trailing={
                    <TextButton
                      label={t(`${PANEL}.join`)}
                      onPress={() => {
                        haptics.tap();
                        void run(() => jamJoin(entry.id));
                      }}
                    />
                  }
                />
              );
            })
          ) : (
            <PageState
              loading={jamsQuery.isPending}
              error={jamsQuery.isError ? jamsQuery.error : undefined}
              onRetry={() => void jamsQuery.refetch()}
              skeleton={<ListSkeleton rows={2} round />}
              empty
              emptyIcon="users"
              emptyText={t("native.jam.noJoinable")}
            />
          )}
        </>
      ) : (
        <>
          {!isHost && jam.queue_mode === "everyone" ? (
            <View
              style={{
                flexDirection: "row",
                gap: 10,
                paddingHorizontal: gutter,
                marginTop: 8,
              }}
            >
              <Icon name="play" size={16} color={tokens.mutedForeground} />
              <Text style={[pageType.meta, { flex: 1, color: tokens.mutedForeground }]}>
                {t(`${PANEL}.proposeHint`)}
              </Text>
            </View>
          ) : null}

          <JamRules jam={jam} isHost={isHost} />
          <JamUpcoming onModerate={setModerate} />

          <SectionLabel title={t(`${PANEL}.membersCount`, { count: jam.members.length })} />
          {jam.members.map((member, index) => (
            <ListRow
              key={member.id}
              title={`${member.name || member.handle}${
                member.id === myId ? ` ${t(`${PANEL}.you`)}` : ""
              }`}
              leading={<ArtworkImage uri={avatarUrl(member.id)} size={40} shape="circle" />}
              last={index === jam.members.length - 1}
              // Outra pessoa: tocar abre denunciar (ela ou a jam) e bloquear.
              onPress={
                member.id === myId
                  ? undefined
                  : () => setModerate({ person: member, content: { kind: "jam", id: jam.id } })
              }
              trailing={
                member.is_host ? (
                  <Text style={[pageType.meta, { color: tokens.mutedForeground }]}>
                    {t("native.jam.hostBadge")}
                  </Text>
                ) : null
              }
            />
          ))}

          {inviteList}

          <View style={{ marginTop: 28 }}>
            <ListRow
              destructive
              icon="x"
              last
              disabled={busy}
              title={t(isHost ? `${PANEL}.endJam` : `${PANEL}.leaveJam`)}
              onPress={() => {
                haptics.press();
                if (isHost) setConfirmEnd(true);
                else void run(() => jamLeave());
              }}
            />
          </View>
        </>
      )}

      <ModerationSheet
        visible={moderate !== null}
        onClose={() => setModerate(null)}
        person={moderate?.person ?? null}
        content={moderate?.content ?? null}
      />

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
