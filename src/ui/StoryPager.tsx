/**
 * Visor de stories (pedido do dono, 2026-08-18: "Rewind estilo stories do
 * Instagram"). Ecrã inteiro, barras segmentadas no topo, avanço automático,
 * toque à direita avança / à esquerda recua, manter premido pausa. Genérico
 * de propósito: o Rewind é o primeiro inquilino, os previews de artista são
 * o segundo - cada cartão é só um render().
 *
 * A aritmética vive em storyMath.ts (bun-testada); aqui fica o relógio (um
 * interval de 50 ms enquanto o visor existe - morre com o unmount) e os
 * gestos.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "@/i18n";
import { Icon } from "./icons";
import { nextStoryIndex, prevStoryIndex, segmentFill, tickProgress } from "./storyMath";

export interface StoryCard {
  key: string;
  /** Conteúdo do cartão; desenha por baixo das barras e dos gestos. */
  render: () => React.ReactNode;
  durationMs?: number;
}

const DEFAULT_DURATION_MS = 6_000;
const CLOCK_MS = 50;

export const StoryPager = ({
  cards,
  onClose,
  onIndexChange,
}: {
  cards: readonly StoryCard[];
  onClose: () => void;
  /** O Rewind usa isto para pré-carregar; os previews para trocar o áudio. */
  onIndexChange?: (index: number) => void;
}) => {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const paused = useRef(false);
  // O relógio vive em refs e só ESPELHA no estado: avançar de cartão a
  // partir de um efeito dispararia o lint de cascata do compilador, e a
  // partir de um updater seria setState dentro de setState. No callback do
  // interval pode-se tudo.
  const progressRef = useRef(0);
  const indexRef = useRef(0);

  const goTo = useCallback(
    (next: number | null): void => {
      if (next === null) {
        onClose();
        return;
      }
      indexRef.current = next;
      progressRef.current = 0;
      setIndex(next);
      setProgress(0);
      onIndexChange?.(next);
    },
    [onClose, onIndexChange],
  );
  const goToRef = useRef(goTo);
  useEffect(() => {
    goToRef.current = goTo;
  });

  const card = cards[index];
  const duration = card?.durationMs ?? DEFAULT_DURATION_MS;

  // Teclado na web (o Rewind também vive no desktop): setas navegam
  // cartões, Escape fecha. Em CAPTURE e com stopPropagation, porque as
  // setas nuas são agora seek global (DesktopShortcuts) e dentro do visor
  // navegar tem de ganhar ao motor.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const target =
        event.key === "ArrowRight"
          ? nextStoryIndex(indexRef.current, cards.length)
          : prevStoryIndex(indexRef.current);
      goToRef.current(target);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [cards.length, onClose]);

  useEffect(() => {
    if (!card) return;
    const timer = setInterval(() => {
      if (paused.current) return;
      const next = tickProgress(progressRef.current, CLOCK_MS, duration);
      if (next >= 1) {
        goToRef.current(nextStoryIndex(indexRef.current, cards.length));
        return;
      }
      progressRef.current = next;
      setProgress(next);
    }, CLOCK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, duration, cards.length]);

  if (!card) return null;

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {card.render()}

      {/* Zonas de toque: terço esquerdo recua, o resto avança; manter
          premido em qualquer uma pausa o relógio. */}
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row" }}>
        <Pressable
          style={{ flex: 1 }}
          onPress={() => goTo(prevStoryIndex(index))}
          onLongPress={() => {
            paused.current = true;
          }}
          onPressOut={() => {
            paused.current = false;
          }}
          accessibilityLabel={t("components.music.Rewind.previous")}
        />
        <Pressable
          style={{ flex: 2 }}
          onPress={() => goTo(nextStoryIndex(index, cards.length))}
          onLongPress={() => {
            paused.current = true;
          }}
          onPressOut={() => {
            paused.current = false;
          }}
          accessibilityLabel={t("components.music.Rewind.next")}
        />
      </View>

      {/* Barras segmentadas, por cima das zonas de toque mas inertes. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: insets.top + 10,
          left: 12,
          right: 12,
          flexDirection: "row",
          gap: 4,
        }}
      >
        {cards.map((c, i) => (
          <View
            key={c.key}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              backgroundColor: "rgba(255,255,255,0.3)",
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: `${segmentFill(i, index, progress) * 100}%`,
                height: 3,
                backgroundColor: "#ffffff",
              }}
            />
          </View>
        ))}
      </View>

      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t("components.music.Rewind.close")}
        hitSlop={10}
        style={{ position: "absolute", top: insets.top + 24, right: 16, padding: 4 }}
      >
        <Icon name="x" size={22} color="#ffffff" />
      </Pressable>
      <Text
        style={{
          position: "absolute",
          top: insets.top + 26,
          left: 16,
          color: "rgba(255,255,255,0.8)",
          fontSize: 12,
          fontWeight: "700",
        }}
        pointerEvents="none"
      >
        {`${index + 1}/${cards.length}`}
      </Text>
    </View>
  );
};
