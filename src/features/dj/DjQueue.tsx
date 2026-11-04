/**
 * A fila EM MODO ESTACAO (dono, 2026-08-31: "a queue podia se adaptar ao DJ
 * e ter uma UI diferente").
 *
 * A fila normal e uma lista de musicas que o ouvinte pos la: arrasta-se,
 * tira-se, abre menu. Nada disso faz sentido aqui - a alinhavada e dele, as
 * falas nao sao musicas, e a unica coisa a frente e a proxima. Entao esta
 * vista mostra o que a noite JA foi, o que esta a dar, e o que vem a
 * seguir; sem pegas, sem menus, sem baralhar nem repetir (uma estacao nao
 * tem nem uma coisa nem outra).
 *
 * Tocar numa linha salta para ela, que e como se volta atras a meio da
 * sessao.
 *
 * Uma noite longa sao centenas de linhas: FlatList com altura fixa
 * (getItemLayout), linhas com memo, e a lista abre ja na musica actual.
 */
import React, { memo, useCallback, useMemo } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { getTransport } from "@/contracts/transport";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists } from "@/domain/format";
import { isDjClip, type Song } from "@/domain/song";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { usePlaybackView } from "@/remote/mirror";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ArtworkImage, Icon } from "@/ui";
import { pageType, useGutter } from "@/ui/page";
import { DjArtwork } from "./DjArtwork";
import { useDjStation } from "./station";

const D = "components.music.Dj";
const K = "native.player";
/** Altura fixa de cada linha (capa de 44 + 8 de cada lado). */
const ROW_HEIGHT = 60;

const Row = memo(function Row({
  song,
  visibleIndex,
  current,
  past,
  speaking,
  gutter,
  onPressRow,
}: {
  song: Song;
  visibleIndex: number;
  current: boolean;
  past: boolean;
  speaking: boolean;
  gutter: number;
  onPressRow: (visibleIndex: number, current: boolean) => void;
}) {
  const t = useT();
  const { tokens } = useTheme();
  const clip = isDjClip(song);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={song.title}
      onPress={() => onPressRow(visibleIndex, current)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        height: ROW_HEIGHT,
        paddingHorizontal: gutter,
        backgroundColor: pressed ? tokens.secondary : "transparent",
        opacity: past ? 0.45 : 1,
      })}
    >
      {clip ? (
        <DjArtwork size={44} speaking={current && speaking} />
      ) : (
        <ArtworkImage source={songArtworkSource(song)} songId={song.id} size={44} />
      )}
      <View style={{ flexShrink: 1, minWidth: 0, flex: 1 }}>
        <Text
          numberOfLines={1}
          style={[pageType.body, { color: tokens.foreground, fontWeight: current ? "700" : "500" }]}
        >
          {clip ? (song.dj_clip?.theme ?? t(`${D}.title`)) : song.title}
        </Text>
        <Text numberOfLines={1} style={[pageType.meta, { color: tokens.mutedForeground }]}>
          {clip ? t(`${D}.interjection`) : formatArtists(song)}
        </Text>
      </View>
      {current ? <Icon name="volume" size={16} color={tokens.foreground} /> : null}
    </Pressable>
  );
});

export const DjQueue = () => {
  const t = useT();
  const { tokens } = useTheme();
  const gutter = useGutter();
  const queue = usePlaybackView((v) => v.queue);
  const order = usePlaybackView((v) => v.queueOrder);
  const index = usePlaybackView((v) => v.queueIndex);
  const planning = useDjStation((s) => s.planning);
  const theme = useDjStation((s) => s.theme);
  const speaking = useDjStation((s) => s.speaking);

  // So muda quando a fila muda: o leitor emite estado 4x/s.
  const visible = useMemo(
    () => order.map((backing) => queue[backing]).filter((song): song is Song => !!song),
    [order, queue],
  );

  const onPressRow = useCallback((visibleIndex: number, current: boolean) => {
    haptics.tap();
    if (current) getTransport().toggle();
    else getTransport().setQueueIndex(visibleIndex);
  }, []);

  const renderItem = useCallback(
    ({ item, index: visibleIndex }: { item: Song; index: number }) => (
      <Row
        song={item}
        visibleIndex={visibleIndex}
        current={visibleIndex === index}
        past={visibleIndex < index}
        speaking={visibleIndex === index && speaking}
        gutter={gutter}
        onPressRow={onPressRow}
      />
    ),
    [gutter, index, onPressRow, speaking],
  );

  const getItemLayout = useCallback(
    (_: unknown, i: number) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * i, index: i }),
    [],
  );

  // O fim da lista e sempre o mesmo: o que vem a seguir ainda esta a ser
  // pensado. Deixar a lista acabar em nada era o que fazia parecer que a
  // estacao tinha morrido.
  const footer = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: gutter,
        paddingTop: 8,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: RADIUS,
          borderWidth: 1,
          borderStyle: "dashed",
          borderColor: tokens.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="radio" size={16} color={tokens.mutedForeground} />
      </View>
      <Text style={[pageType.meta, { color: tokens.mutedForeground, flexShrink: 1 }]}>
        {planning ? t(`${D}.planning`) : t(`${D}.upNextHint`)}
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          paddingHorizontal: gutter,
          paddingBottom: 12,
        }}
      >
        <DjArtwork size={44} speaking={false} />
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[pageType.body, { color: tokens.foreground, fontWeight: "700" }]}>
            {t(`${D}.title`)}
          </Text>
          <Text numberOfLines={1} style={[pageType.meta, { color: tokens.mutedForeground }]}>
            {theme ?? t(`${D}.onAir`)}
          </Text>
        </View>
      </View>

      <FlatList
        data={visible}
        renderItem={renderItem}
        keyExtractor={(song, i) => `${song.id}-${i}`}
        getItemLayout={getItemLayout}
        // Abre na musica actual (com duas de contexto por cima), nao no inicio
        // de uma noite de tres horas.
        initialScrollIndex={visible.length > 0 ? Math.max(0, Math.min(index - 2, visible.length - 1)) : undefined}
        initialNumToRender={14}
        windowSize={7}
        maxToRenderPerBatch={12}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: 24 }}
      />

      <Text
        style={{
          color: tokens.mutedForeground,
          fontSize: 12,
          textAlign: "center",
          paddingVertical: 8,
        }}
      >
        {t(`${K}.upNext`)}
      </Text>
    </View>
  );
};
