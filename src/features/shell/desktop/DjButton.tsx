/**
 * A porta de "O Melhor DJ" na barra do desktop. Ate 2026-08-31 este botao
 * ERA o DJ: pausava, pedia uma frase sobre a musica seguinte, falava e
 * saltava - "a unica coisa que ele faz e passar para a proxima musica"
 * (dono). O DJ passou a ser uma estacao (features/dj), com pagina propria e
 * a voz na fila, e o botao voltou a ser o que sempre devia ter sido: a
 * maneira de la chegar.
 */
import React from "react";
import { useRouter } from "expo-router";
import { djRoute } from "@/lib/routes";
import { useT } from "@/i18n";
import { GhostIconButton } from "@/ui";

export const DjButton = ({ disabled }: { disabled: boolean }) => {
  const t = useT();
  const router = useRouter();

  return (
    <GhostIconButton
      icon="radio"
      size={17}
      disabled={disabled}
      accessibilityLabel={t("native.dj.open")}
      onPress={() => router.push(djRoute)}
    />
  );
};
