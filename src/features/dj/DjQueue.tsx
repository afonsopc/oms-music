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
 */
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { getTransport } from "@/contracts/transport";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists } from "@/domain/format";
import { isDjClip, type Song } from "@/domain/song";
import { useT } from "@/i18n";
import { usePlaybackView } from "@/remote/mirror";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ArtworkImage, Icon } from "@/ui";
import { DjArtwork } from "./DjArtwork";
import { paletteFor } from "./palette";
import { useDjStation } from "./station";

const D = "components.music.Dj";
const K = "native.player";

const Row = ({
  song,
  current,
  past,
  onPress,
}: {
  song: Song;
  current: boolean;
  past: boolean;
  onPress: () => void;
}) => {
  const t = useT();
  const { tokens } = useTheme();
  const styles = useDjStation((s) => s.styles);
  const speaking = useDjStation((s) => s.speaking);
  const clip = isDjClip(song);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={song.title}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 20,
        paddingVertical: 8,
        opacity: pressed ? 0.7 : past ? 0.45 : 1,
      })}
    >
      {clip ? (
        <DjArtwork size={44} speaking={current && speaking} palette={paletteFor(styles)} />
      ) : (
        <ArtworkImage source={songArtworkSource(song)} songId={song.id} size={44} />
      )}
      <View style={{ flexShrink: 1, minWidth: 0, flex: 1 }}>
        <Text
          numberOfLines={1}
          style={{
            color: current ? tokens.primary : tokens.foreground,
            fontSize: 14,
            fontWeight: current ? "800" : "600",
          }}
        >
          {clip ? (song.dj_clip?.theme ?? t(`${D}.title`)) : song.title}
        </Text>
        <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 12 }}>
          {clip ? t(`${D}.interjection`) : formatArtists(song)}
        </Text>
      </View>
      {current ? <Icon name="volume" size={15} color={tokens.primary} /> : null}
    </Pressable>
  );
};

export const DjQueue = () => {
  const t = useT();
  const { tokens } = useTheme();
  const queue = usePlaybackView((v) => v.queue);
  const order = usePlaybackView((v) => v.queueOrder);
  const index = usePlaybackView((v) => v.queueIndex);
  const planning = useDjStation((s) => s.planning);
  const theme = useDjStation((s) => s.theme);
  const styles = useDjStation((s) => s.styles);

  const visible = order.map((backing) => queue[backing]).filter((song): song is Song => !!song);

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 20,
          paddingBottom: 12,
        }}
      >
        <DjArtwork size={40} speaking={false} palette={paletteFor(styles)} />
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{ color: tokens.foreground, fontSize: 14, fontWeight: "800" }}
          >
            {t(`${D}.title`)}
          </Text>
          <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 12 }}>
            {theme ?? t(`${D}.onAir`)}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {visible.map((song, visibleIndex) => (
          <Row
            key={`${song.id}-${visibleIndex}`}
            song={song}
            current={visibleIndex === index}
            past={visibleIndex < index}
            onPress={() => {
              if (visibleIndex === index) getTransport().toggle();
              else getTransport().setQueueIndex(visibleIndex);
            }}
          />
        ))}

        {/* O fim da lista e sempre o mesmo: o que vem a seguir ainda esta a
            ser pensado. Deixar a lista acabar em nada era o que fazia
            parecer que a estacao tinha morrido. */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 20,
            paddingTop: 10,
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
          <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
            {planning ? t(`${D}.planning`) : t(`${D}.upNextHint`)}
          </Text>
        </View>
      </ScrollView>

      <Text
        style={{
          color: tokens.mutedForeground,
          fontSize: 11,
          textAlign: "center",
          paddingVertical: 8,
        }}
      >
        {t(`${K}.upNext`)}
      </Text>
    </View>
  );
};
