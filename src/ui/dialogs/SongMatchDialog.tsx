/**
 * "Esta música está errada": o que o matcher encontrou para a faixa, em todos
 * os provedores, pontuado, com as rejeitadas por baixo e a razão à vista.
 *
 * Uma faixa importada por artista e título é EMPARELHADA, não consultada, e o
 * engano clássico é um cover: mesma duração, o nome do artista original no
 * título, e nada que uma verificação de duração possa apanhar. Aqui a escolha
 * passa a ser de quem ouve - uma candidata rejeitada também se pode escolher,
 * porque uma decisão deliberada não se questiona.
 *
 * A reimportação escreve por cima da mesma música: playlists, gostos e
 * histórico ficam de pé, só o áudio muda.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import type { SongMatchCandidate } from "@omelhorsite/sdk";
import { keys } from "@/api/queryKeys";
import { useRematchSong, useSongMatchCandidates } from "@/api/queries/songs";
import { useSongImportPoll } from "@/api/queries/imports";
import { formatDuration } from "@/domain/format";
import type { Song } from "@/domain/song";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { Icon } from "../icons";
import { modalScrim } from "../uiTheme";

export interface SongMatchDialogProps {
  visible: boolean;
  song: Song;
  onClose: () => void;
}

const SOURCE_LABEL: Record<string, string> = {
  youtube: "YouTube",
  soundcloud: "SoundCloud",
  bandcamp: "Bandcamp",
};

const CandidateRow = ({
  candidate,
  busy,
  onPick,
}: {
  candidate: SongMatchCandidate;
  busy: boolean;
  onPick: (url: string) => void;
}) => {
  const { tokens, ink } = useTheme();
  const t = useT();
  const rejected = candidate.score === null;
  const url = candidate.url;

  return (
    <Pressable
      onPress={() => url && onPick(url)}
      disabled={busy || !url}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: RADIUS,
        borderWidth: 1,
        borderColor: candidate.current ? tokens.primary : tokens.border,
        backgroundColor: pressed ? tokens.muted : "transparent",
        opacity: busy ? 0.5 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: tokens.foreground, fontSize: 14 }} numberOfLines={1}>
          {candidate.title ?? "-"}
        </Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 12 }} numberOfLines={1}>
          {[
            SOURCE_LABEL[candidate.source] ?? candidate.source,
            candidate.uploader,
            candidate.duration_s ? formatDuration(candidate.duration_s) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        {rejected && candidate.reject_reason ? (
          <Text style={{ color: ink.destructive, fontSize: 11 }} numberOfLines={2}>
            {candidate.reject_reason}
          </Text>
        ) : null}
        {candidate.current ? (
          <Text style={{ color: tokens.primary, fontSize: 11 }} numberOfLines={1}>
            {t("components.music.SongMatchDialog.current")}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-right" size={17} color={tokens.mutedForeground} />
    </Pressable>
  );
};

export const SongMatchDialog = ({ visible, song, onClose }: SongMatchDialogProps) => {
  const { tokens, scheme } = useTheme();
  const t = useT();
  const [importId, setImportId] = useState<number | null>(null);
  const candidates = useSongMatchCandidates(song.id, visible);
  const rematch = useRematchSong();
  // O import é a única coisa que diz que a troca aconteceu: a música só muda
  // quando ele chega a `complete`.
  const poll = useSongImportPoll(importId, visible && importId !== null);
  const qc = useQueryClient();

  // A troca só existe quando o import fecha: é aí que a música (duração,
  // codec, media ids) deixa de ser a que está em cache em toda a app.
  const finished = poll.data?.state === "complete";
  useEffect(() => {
    if (!finished) return;
    void qc.invalidateQueries({ queryKey: keys.songs.all });
    void qc.invalidateQueries({ queryKey: keys.liked.list });
  }, [finished, qc]);

  if (!visible) return null;

  const start = (sourceUrl?: string) => {
    rematch.mutate(
      { id: song.id, sourceUrl },
      { onSuccess: (created) => setImportId(Number(created.id)) },
    );
  };

  const items = candidates.data ?? [];
  const accepted = items.filter((c) => c.score !== null);
  const rejected = items.filter((c) => c.score === null);
  const state = poll.data?.state;
  const running = rematch.isPending || state === "pending" || state === "processing";

  return (
    <Modal transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: modalScrim(scheme),
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            width: "100%",
            maxWidth: 460,
            maxHeight: "80%",
            borderRadius: RADIUS * 2,
            backgroundColor: tokens.popover,
            borderWidth: 1,
            borderColor: tokens.border,
            padding: 20,
          }}
        >
          <Text
            style={{ color: tokens.foreground, fontSize: 18, fontWeight: "700", marginBottom: 4 }}
          >
            {t("components.music.SongMatchDialog.title")}
          </Text>
          <Text
            style={{ color: tokens.mutedForeground, fontSize: 13, marginBottom: 12 }}
            numberOfLines={1}
          >
            {song.title}
          </Text>

          {state === "complete" ? (
            <Text style={{ color: tokens.primary, fontSize: 13, marginBottom: 12 }}>
              {t("components.music.SongMatchDialog.done")}
            </Text>
          ) : null}
          {state === "failed" ? (
            <Text style={{ color: tokens.mutedForeground, fontSize: 13, marginBottom: 12 }}>
              {poll.data?.error_message ?? t("components.music.SongMatchDialog.failed")}
            </Text>
          ) : null}

          <Pressable
            onPress={() => start()}
            disabled={running}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              paddingVertical: 11,
              borderRadius: RADIUS,
              marginBottom: 14,
              backgroundColor: tokens.primary,
              opacity: running ? 0.5 : pressed ? 0.8 : 1,
            })}
          >
            {running ? <ActivityIndicator size="small" color={tokens.primaryForeground} /> : null}
            <Text style={{ color: tokens.primaryForeground, fontSize: 14, fontWeight: "600" }}>
              {running
                ? (poll.data?.progress_message ?? t("components.music.SongMatchDialog.working"))
                : t("components.music.SongMatchDialog.retryAuto")}
            </Text>
          </Pressable>

          {candidates.isLoading ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <ActivityIndicator color={tokens.mutedForeground} />
              <Text style={{ color: tokens.mutedForeground, fontSize: 12, marginTop: 8 }}>
                {t("components.music.SongMatchDialog.searching")}
              </Text>
            </View>
          ) : null}
          {candidates.isError ? (
            <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
              {t("components.music.SongMatchDialog.unavailable")}
            </Text>
          ) : null}

          <ScrollView bounces={false}>
            <View style={{ gap: 8 }}>
              {accepted.map((c) => (
                <CandidateRow
                  key={`${c.source}-${c.url}`}
                  candidate={c}
                  busy={running}
                  onPick={(url) => start(url)}
                />
              ))}
              {rejected.length > 0 ? (
                <Text
                  style={{
                    color: tokens.mutedForeground,
                    fontSize: 12,
                    fontWeight: "600",
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    marginTop: 8,
                  }}
                >
                  {t("components.music.SongMatchDialog.rejected")}
                </Text>
              ) : null}
              {rejected.map((c) => (
                <CandidateRow
                  key={`${c.source}-${c.url}`}
                  candidate={c}
                  busy={running}
                  onPick={(url) => start(url)}
                />
              ))}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};
