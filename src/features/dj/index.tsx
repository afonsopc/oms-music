/**
 * A pagina de "O Melhor DJ" (dono, 2026-08-31: "a sessao do DJ deve ser tipo
 * uma sessao do assistente muito parecida. a UI/UX e das partes mais
 * importantes aqui").
 *
 * E entao uma conversa, com o mesmo vocabulario do assistente: o que ele
 * disse de um lado, o que pediste do outro, e por baixo de cada intervencao
 * dele a musica que ela apresentou. As voltas em que ele nao fala aparecem
 * como uma linha da musica e mais nada - um balao vazio nao e silencio, e
 * um erro.
 *
 * A pagina NAO e o DJ: a sessao vive em ./station.ts e continua a andar com
 * o ecra fechado. Sair daqui nao cala ninguem.
 */
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists } from "@/domain/format";
import type { Song } from "@/domain/song";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, Icon } from "@/ui";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { DjArtwork } from "./DjArtwork";
import { djStation, useDjStation, type DjTurn } from "./station";

const D = "components.music.Dj";
const HERO = 132;

const SongLine = ({ song }: { song: Song }) => {
  const { tokens } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <ArtworkImage source={songArtworkSource(song)} songId={song.id} size={40} />
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ color: tokens.foreground, fontSize: 13, fontWeight: "600" }}
        >
          {song.title}
        </Text>
        <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 12 }}>
          {formatArtists(song)}
        </Text>
      </View>
    </View>
  );
};

const Turn = ({ turn }: { turn: DjTurn }) => {
  const { tokens } = useTheme();
  if (turn.role === "listener") {
    return (
      <View
        style={{
          alignSelf: "flex-end",
          maxWidth: "85%",
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 16,
          backgroundColor: tokens.primary,
        }}
      >
        <Text style={{ color: tokens.primaryForeground, fontSize: 14, lineHeight: 20 }}>
          {turn.text}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ alignSelf: "flex-start", maxWidth: "92%", gap: 6 }}>
      {turn.text ? (
        <View
          style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 16,
            backgroundColor: tokens.secondary,
          }}
        >
          <Text style={{ color: tokens.foreground, fontSize: 14, lineHeight: 20 }}>
            {turn.text}
          </Text>
        </View>
      ) : null}
      {turn.song ? <SongLine song={turn.song} /> : null}
    </View>
  );
};

export default function DjScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const topPadding = useContentTopPadding(12);
  const bottomPadding = useContentBottomPadding();
  const scrollRef = useRef<ScrollView>(null);
  const [request, setRequest] = useState("");

  const active = useDjStation((s) => s.active);
  const planning = useDjStation((s) => s.planning);
  const speaking = useDjStation((s) => s.speaking);
  const theme = useDjStation((s) => s.theme);
  const turns = useDjStation((s) => s.turns);
  const error = useDjStation((s) => s.error);
  const remote = useDjStation((s) => s.remote);

  // A conversa que ficou a meio: abrir a pagina mostra-a, mesmo que a
  // estacao ja nao esteja no ar.
  useEffect(() => {
    void djStation.restore();
  }, []);

  const send = (): void => {
    const asked = request.trim();
    if (!asked || planning) return;
    setRequest("");
    void djStation.steer(asked);
  };

  const status = planning
    ? t(`${D}.planning`)
    : active
      ? (theme ?? t(`${D}.onAir`))
      : t(`${D}.pitch`);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          paddingTop: topPadding,
          paddingHorizontal: 20,
          paddingBottom: 12,
          gap: 12,
        }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        <View style={{ alignItems: "center", gap: 10, paddingBottom: 8 }}>
          <DjArtwork size={HERO} speaking={speaking} />
          <Text style={{ color: tokens.foreground, fontSize: 24, fontWeight: "900" }}>
            {t(`${D}.title`)}
          </Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 14, textAlign: "center" }}>
            {status}
          </Text>
          {active ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(`${D}.stop`)}
              onPress={() => djStation.stop()}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: 4 })}
            >
              <Text style={{ color: tokens.mutedForeground, fontSize: 13, fontWeight: "700" }}>
                {t(`${D}.stop`)}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(`${D}.start`)}
              disabled={planning}
              onPress={() => void djStation.start()}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                paddingHorizontal: 24,
                paddingVertical: 12,
                borderRadius: 999,
                backgroundColor: tokens.primary,
                opacity: planning ? 0.5 : pressed ? 0.8 : 1,
              })}
            >
              {planning ? (
                <ActivityIndicator color={tokens.primaryForeground} />
              ) : (
                <Icon name="radio" size={18} color={tokens.primaryForeground} />
              )}
              <Text style={{ color: tokens.primaryForeground, fontSize: 15, fontWeight: "800" }}>
                {t(`${D}.start`)}
              </Text>
            </Pressable>
          )}
        </View>

        {remote ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 13, textAlign: "center" }}>
            {t(`${D}.remoteOnly`)}
          </Text>
        ) : null}
        {error ? (
          <Text style={{ color: tokens.destructive, fontSize: 13, textAlign: "center" }}>
            {t(`${D}.failed`)}
          </Text>
        ) : null}

        {turns.map((turn) => (
          <Turn key={turn.key} turn={turn} />
        ))}

        {planning && active ? (
          <View style={{ alignSelf: "flex-start", padding: 8 }}>
            <ActivityIndicator size="small" color={tokens.mutedForeground} />
          </View>
        ) : null}
      </ScrollView>

      {/* A caixa de pedido e a mesma porta do assistente: escrever o que se
          quer ouvir. Um pedido fica em vigor ate se pedir outra coisa. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: bottomPadding + 8,
        }}
      >
        <TextInput
          value={request}
          onChangeText={setRequest}
          placeholder={t(`${D}.placeholder`)}
          placeholderTextColor={tokens.mutedForeground}
          onSubmitEditing={send}
          editable={!planning}
          style={{
            flex: 1,
            color: tokens.foreground,
            backgroundColor: tokens.secondary,
            borderRadius: 999,
            paddingHorizontal: 16,
            paddingVertical: 10,
            fontSize: 14,
          }}
        />
        {/* O botao dele, ao lado da caixa: falar agora sobre o que vem a
            seguir, sem mudar a direccao da sessao. */}
        {active ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(`${D}.speakNow`)}
            onPress={() => void djStation.speakNow()}
            disabled={planning}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: tokens.secondary,
              opacity: planning ? 0.4 : pressed ? 0.7 : 1,
            })}
          >
            <Icon name="radio" size={18} color={tokens.secondaryForeground} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(`${D}.sendRequest`)}
          onPress={send}
          disabled={planning || request.trim().length === 0}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: tokens.primary,
            opacity: planning || request.trim().length === 0 ? 0.4 : pressed ? 0.7 : 1,
          })}
        >
          <Icon name="chevron-right" size={18} color={tokens.primaryForeground} />
        </Pressable>
      </View>
    </View>
  );
}
