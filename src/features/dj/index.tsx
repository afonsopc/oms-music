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
 *
 * Redesenho 2026-11-04 (docs/redesenho.md, "O padrao"): a capa grande e
 * carvao com a voz a branco, o titulo da pagina, uma so accao principal
 * ("Comecar a estacao"); o que ele diz e texto corrido, o que pedes vai
 * num balao cinzento; a espera e um esqueleto com a frase que muda, e um
 * erro e o estado de erro comum com "Tentar de novo".
 */
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists } from "@/domain/format";
import type { Song } from "@/domain/song";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, ErrorState, Icon, Skeleton, useContainerWidth } from "@/ui";
import { PressableScale, Reveal } from "@/ui/motion";
import { PageTitle, pageType, TextButton, useGutter, WaitHint } from "@/ui/page";
import { usePlaybackView } from "@/remote/mirror";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { DjArtwork } from "./DjArtwork";
import { djStation, useDjStation, type DjTurn } from "./station";

const D = "components.music.Dj";
/** A capa nunca passa disto, nem no computador. */
const HERO_MAX = 280;
/** Uma noite longa nao monta centenas de baloes: so as ultimas voltas. */
const TURNS_SHOWN = 60;

const SongLine = ({ song }: { song: Song }) => {
  const { tokens } = useTheme();
  // Qual das voltas e a que se esta a ouvir agora. Sem isto a conversa e uma
  // lista de coisas que aconteceram, sem um "estamos aqui".
  const playing = usePlaybackView((v) => v.song?.id === song.id);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <ArtworkImage source={songArtworkSource(song)} songId={song.id} size={44} />
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={[pageType.body, { color: tokens.foreground, fontWeight: playing ? "700" : "500" }]}
        >
          {song.title}
        </Text>
        <Text numberOfLines={1} style={[pageType.meta, { color: tokens.mutedForeground }]}>
          {formatArtists(song)}
        </Text>
      </View>
      {playing ? <Icon name="volume" size={16} color={tokens.foreground} /> : null}
    </View>
  );
};

const Turn = ({ turn }: { turn: DjTurn }) => {
  const { tokens } = useTheme();
  if (turn.role === "listener") {
    return (
      <Reveal distance={8} duration={220}>
        <View
          style={{
            alignSelf: "flex-end",
            maxWidth: "85%",
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 18,
            backgroundColor: tokens.secondary,
          }}
        >
          <Text style={[pageType.body, { color: tokens.foreground }]}>{turn.text}</Text>
        </View>
      </Reveal>
    );
  }

  return (
    <Reveal distance={8} duration={260}>
      <View style={{ alignSelf: "stretch", gap: 10 }}>
        {turn.text ? (
          <Text style={[pageType.body, { color: tokens.foreground, lineHeight: 23 }]}>
            {turn.text}
          </Text>
        ) : null}
        {turn.song ? <SongLine song={turn.song} /> : null}
      </View>
    </Reveal>
  );
};

/** Ele esta a pensar: tres linhas a brilhar onde a fala vai aparecer. */
const ThinkingSkeleton = () => (
  <View style={{ gap: 8, paddingVertical: 4 }}>
    <Skeleton width="78%" height={13} />
    <Skeleton width="62%" height={13} />
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 }}>
      <Skeleton width={44} height={44} borderRadius={6} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton width="50%" height={13} />
        <Skeleton width="32%" height={11} />
      </View>
    </View>
  </View>
);

export default function DjScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const gutter = useGutter();
  const containerWidth = useContainerWidth();
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

  const hero = Math.min(HERO_MAX, Math.max(160, containerWidth - gutter * 2));
  const shownTurns = turns.length > TURNS_SHOWN ? turns.slice(-TURNS_SHOWN) : turns;

  // A conversa que ficou a meio: abrir a pagina mostra-a, mesmo que a
  // estacao ja nao esteja no ar.
  useEffect(() => {
    void djStation.restore();
  }, []);

  const start = (): void => {
    haptics.tap();
    void djStation.start();
  };

  const send = (): void => {
    const asked = request.trim();
    if (!asked) return;
    haptics.select();
    setRequest("");
    // Nunca se recusa uma mensagem por ele estar a pensar: a estacao poe-a
    // em fila (ver station.steer).
    void djStation.steer(asked);
  };

  const status = planning
    ? t(`${D}.planning`)
    : active
      ? (theme ?? t(`${D}.onAir`))
      : t(`${D}.pitch`);
  const canSend = request.trim().length > 0;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          paddingTop: topPadding,
          paddingHorizontal: gutter,
          paddingBottom: 16,
          gap: 18,
        }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        <Reveal>
          <DjArtwork size={hero} speaking={speaking} />
        </Reveal>

        <Reveal order={1}>
          <View style={{ gap: 6 }}>
            <PageTitle>{t(`${D}.title`)}</PageTitle>
            <Text style={[pageType.body, { color: tokens.mutedForeground }]}>{status}</Text>
          </View>
        </Reveal>

        <Reveal order={2}>
          {active ? (
            <View style={{ flexDirection: "row" }}>
              <TextButton
                label={t(`${D}.stop`)}
                onPress={() => {
                  haptics.select();
                  djStation.stop();
                }}
              />
            </View>
          ) : (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t(`${D}.start`)}
              disabled={planning}
              onPress={start}
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
                opacity: planning ? 0.6 : 1,
              }}
            >
              {planning ? (
                <ActivityIndicator color={tokens.primaryForeground} />
              ) : (
                <Icon name="radio" size={18} color={tokens.primaryForeground} />
              )}
              <Text style={{ color: tokens.primaryForeground, fontSize: 16, fontWeight: "700" }}>
                {t(`${D}.start`)}
              </Text>
            </PressableScale>
          )}
        </Reveal>

        {remote ? (
          <Text style={[pageType.meta, { color: tokens.mutedForeground }]}>
            {t(`${D}.remoteOnly`)}
          </Text>
        ) : null}
        {error ? (
          <ErrorState
            text={t(`${D}.failed`)}
            onRetry={active ? undefined : start}
            style={{ paddingVertical: 24 }}
          />
        ) : null}

        {shownTurns.length > 0 ? (
          <View style={{ height: 1, backgroundColor: tokens.border }} />
        ) : null}

        {shownTurns.map((turn) => (
          <Turn key={turn.key} turn={turn} />
        ))}

        {planning && active ? <ThinkingSkeleton /> : null}
        {planning ? <WaitHint active style={{ paddingVertical: 0 }} /> : null}
      </ScrollView>

      {/* A caixa de pedido e a mesma porta do assistente: escrever o que se
          quer ouvir. Um pedido fica em vigor ate se pedir outra coisa. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: gutter,
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
          style={{
            flex: 1,
            minWidth: 0,
            height: 44,
            color: tokens.foreground,
            backgroundColor: tokens.secondary,
            borderRadius: 22,
            paddingHorizontal: 16,
            fontSize: 16,
          }}
        />
        {/* O botao dele, ao lado da caixa: falar agora sobre o que vem a
            seguir, sem mudar a direccao da sessao. */}
        {active ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(`${D}.speakNow`)}
            onPress={() => {
              haptics.tap();
              void djStation.speakNow();
            }}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? tokens.muted : tokens.secondary,
            })}
          >
            <Icon name="mic" size={18} color={tokens.foreground} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(`${D}.sendRequest`)}
          onPress={send}
          disabled={!canSend}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: canSend ? tokens.primary : tokens.secondary,
            transform: [{ scale: pressed ? 0.94 : 1 }],
          })}
        >
          <Icon
            name="chevron-right"
            size={18}
            color={canSend ? tokens.primaryForeground : tokens.mutedForeground}
          />
        </Pressable>
      </View>
    </View>
  );
}
