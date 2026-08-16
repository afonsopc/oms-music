/**
 * Superfície de TESTE de "O Melhor DJ" (dono, 2026-08-16: "deploy pra eu
 * testar o dj enquanto o workflow trabalha"). Um botão na barra do desktop:
 * pausa o player, pede uma intervenção ao backend (guião LLM + voz Kokoro)
 * sobre a música actual e a seguinte, toca o clip e retoma. A integração a
 * sério - falar por cima do instrumental na fronteira das faixas, com
 * stems - vem na vaga 2; isto existe para ouvir o DJ hoje.
 *
 * Só desktop/web: o clip toca por um <audio> do DOM, fora do motor (o
 * player nunca sabe que o DJ falou; retomar é um play() normal).
 */
import React from "react";
import { getTransport } from "@/contracts/transport";
import { fetchDjInterstitial } from "@/api/endpoints/musicDj";
import { getPlaybackView } from "@/remote/mirror";
import { useT } from "@/i18n";
import { GhostIconButton } from "@/ui";

export const DjButton = ({ disabled }: { disabled: boolean }) => {
  const t = useT();
  const [busy, setBusy] = React.useState(false);

  const speak = (): void => {
    if (busy) return;
    const view = getPlaybackView();
    const current = view.song;
    if (!current) return;
    const next = view.queue[view.queueOrder[view.queueIndex + 1] ?? -1] ?? null;
    setBusy(true);
    void (async () => {
      try {
        const clip = await fetchDjInterstitial(next?.id ?? current.id, next ? current.id : null);
        const transport = getTransport();
        const wasPlaying = view.playing;
        if (wasPlaying) transport.pause();
        // Blob e nao data:: a CSP do shell so permite blob: em media-src, e o
        // data: falhava MUDO (pausa+retoma = o "small jump" que o dono viu).
        const bytes = Uint8Array.from(atob(clip.audio_base64), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
        try {
          await new Promise<void>((resolve) => {
            const audio = new Audio(url);
            audio.onended = () => resolve();
            audio.onerror = () => resolve();
            void audio.play().catch(() => resolve());
          });
        } finally {
          URL.revokeObjectURL(url);
        }
        // O DJ apresentou a SEGUINTE: a app avança mesmo para ela quando ele
        // acaba de falar - prometer Katy Perry e retomar a mesma faixa era
        // mentir ao ouvinte (dono, 2026-08-16). Sem seguinte, retoma.
        if (next) {
          transport.next();
          if (!wasPlaying) transport.play();
        } else if (wasPlaying) {
          transport.play();
        }
      } catch {
        // Sem toast próprio na superfície de teste: o botão volta a ficar
        // activo e o dono tenta outra vez (o backend loga o motivo).
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <GhostIconButton
      icon="radio"
      size={17}
      disabled={disabled || busy}
      accessibilityLabel={t("native.dj.speak")}
      onPress={speak}
    />
  );
};
