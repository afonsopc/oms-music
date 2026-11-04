/**
 * O mini-leitor (FR-16): um cartão neutro com a capa (44), título e
 * artistas, o botão de aparelhos e play/pausa, e a barra fina do progresso no
 * rebordo de baixo. Tocar abre o leitor.
 *
 * No nativo também se arrasta (MiniPlayerSwipe): para o lado muda de música,
 * para cima abre o leitor, sempre com um toque háptico. A web não leva gestos.
 *
 * `attachedTop`: a linha "A tocar em X" (DevicePicker) está colada por cima,
 * por isso os cantos de cima ficam direitos e os dois leem-se como uma peça.
 *
 * Lê só a projecção da reprodução (usePillPlayerState) e o contrato do
 * transporte; o progresso vive numa folha à parte (usePillProgress), para a
 * pílula não se redesenhar 4 vezes por segundo.
 */
import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { getTransport } from "@/contracts/transport";
import { cardPressRole } from "@/ui/a11y";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists } from "@/domain/format";
import { isDjClip } from "@/domain/song";
import { DjNowArtwork } from "@/features/dj/DjArtwork";
import { imageUrl } from "@/api/mediaUrl";
import { haptics } from "@/lib/haptics";
import { PLACEHOLDER_ARTWORK } from "@/theme/placeholder";
import { useTheme } from "@/theme/provider";
import { SCRIM_BASE } from "@/theme/tokens";
import { useT } from "@/i18n";
import { getShellSlots, useShellSlotsVersion } from "./slots";
import { usePillPlayerState, usePillProgress } from "./usePillPlayerState";
import { OVERLAY_PILL_HEIGHT } from "./metrics";
import { PauseGlyph, PlayGlyph } from "./glyphs";
import { MiniPlayerSwipe } from "./MiniPlayerSwipe";
import type { MiniSwipe } from "./miniSwipeMath";

const ART = 44;

export const MiniPlayer = ({ attachedTop = false }: { attachedTop?: boolean }) => {
  const { song, playing, buffering } = usePillPlayerState();
  useShellSlotsVersion();
  const { tokens } = useTheme();
  const t = useT();
  const router = useRouter();

  if (!song) return null;

  const artwork = songArtworkSource(song);
  const artworkSource =
    artwork.kind === "node"
      ? { uri: imageUrl(artwork.nodeId) }
      : artwork.kind === "external"
        ? { uri: artwork.url }
        : PLACEHOLDER_ARTWORK;

  const CastButton = getShellSlots().castButton;
  const artistsLine = formatArtists(song);
  const openPlayer = () => router.push("/(player)/now-playing");

  const onSwipe = (swipe: Exclude<MiniSwipe, null>) => {
    haptics.tap();
    if (swipe === "open") openPlayer();
    else if (swipe === "next") getTransport().next();
    else getTransport().previous();
  };

  const radius = 12;

  return (
    <MiniPlayerSwipe onSwipe={onSwipe}>
      <Pressable
        accessibilityRole={cardPressRole}
        accessibilityLabel={t("components.music.BottomBar.openPlayer")}
        onPress={openPlayer}
        style={({ pressed }) => ({
          height: OVERLAY_PILL_HEIGHT,
          borderRadius: radius,
          borderTopLeftRadius: attachedTop ? 0 : radius,
          borderTopRightRadius: attachedTop ? 0 : radius,
          overflow: "hidden",
          backgroundColor: pressed ? tokens.secondary : tokens.card,
          borderWidth: 1,
          borderColor: tokens.border,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 10,
          paddingRight: 6,
          shadowColor: SCRIM_BASE,
          shadowOpacity: 0.35,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        })}
      >
        {/* Uma intervenção do DJ não tem capa: tem a dele, a dançar enquanto
            ele fala (features/dj). */}
        {isDjClip(song) ? (
          <DjNowArtwork size={ART} />
        ) : (
          <Image
            source={artworkSource}
            placeholder={PLACEHOLDER_ARTWORK}
            recyclingKey={String(song.id)}
            transition={160}
            style={{ width: ART, height: ART, borderRadius: 6, backgroundColor: tokens.muted }}
            contentFit="cover"
          />
        )}
        <View style={{ flex: 1, minWidth: 0, marginHorizontal: 12 }}>
          <Text
            numberOfLines={1}
            style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}
          >
            {song.title}
          </Text>
          {artistsLine ? (
            <Text
              numberOfLines={1}
              style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 1 }}
            >
              {artistsLine}
            </Text>
          ) : null}
        </View>
        {CastButton ? <CastButton /> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            playing ? t("components.music.BottomBar.pause") : t("components.music.BottomBar.play")
          }
          hitSlop={8}
          onPress={(event) => {
            event.stopPropagation();
            haptics.tap();
            getTransport().toggle();
          }}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
            transform: [{ scale: pressed ? 0.92 : 1 }],
          })}
        >
          {buffering ? (
            <ActivityIndicator size="small" color={tokens.foreground} />
          ) : playing ? (
            <PauseGlyph color={tokens.foreground} size={16} />
          ) : (
            <PlayGlyph color={tokens.foreground} size={16} />
          )}
        </Pressable>
        <MiniProgress track={tokens.border} fill={tokens.foreground} />
      </Pressable>
    </MiniPlayerSwipe>
  );
};

const MiniProgress = ({ track, fill }: { track: string; fill: string }) => {
  const progress = usePillProgress();
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", left: 10, right: 10, bottom: 0, height: 2, backgroundColor: track }}
    >
      <View style={{ width: `${progress * 100}%`, height: 2, backgroundColor: fill }} />
    </View>
  );
};
