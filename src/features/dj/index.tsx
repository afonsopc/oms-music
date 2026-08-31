/**
 * A pagina de "O Melhor DJ" (dono, 2026-08-31: "tem que ser uma cena tipo a
 * pagina do rewind ou assistente"). E a sala de controlo da estacao: ele ao
 * centro, o bloco que esta a dar, o que acabou de dizer, e duas maneiras de
 * mandar nele - o botao (fala agora) e a caixa de pedido (muda a vibe).
 *
 * A pagina NAO e o DJ. A sessao vive em ./station.ts e continua a andar com
 * o ecra fechado: sair daqui nao cala ninguem, e voltar mostra o estado.
 */
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { Icon } from "@/ui";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { DjArtwork } from "./DjArtwork";
import { djStation, useDjStation } from "./station";

const D = "components.music.Dj";
const ARTWORK = 220;

export default function DjScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const topPadding = useContentTopPadding();
  const bottomPadding = useContentBottomPadding();
  const [request, setRequest] = useState("");

  const active = useDjStation((s) => s.active);
  const planning = useDjStation((s) => s.planning);
  const speaking = useDjStation((s) => s.speaking);
  const theme = useDjStation((s) => s.theme);
  const script = useDjStation((s) => s.script);
  const error = useDjStation((s) => s.error);
  const remote = useDjStation((s) => s.remote);

  const send = (): void => {
    const asked = request.trim();
    setRequest("");
    void djStation.again(asked.length > 0 ? asked : undefined);
  };

  return (
    <ScrollView
      contentContainerStyle={{
        paddingTop: topPadding + 16,
        paddingBottom: bottomPadding + 24,
        paddingHorizontal: 24,
        alignItems: "center",
        gap: 20,
      }}
    >
      <DjArtwork size={ARTWORK} speaking={speaking} />

      <View style={{ alignItems: "center", gap: 6 }}>
        <Text style={{ color: tokens.foreground, fontSize: 24, fontWeight: "800" }}>
          {t(`${D}.title`)}
        </Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 14, textAlign: "center" }}>
          {planning
            ? t(`${D}.planning`)
            : active
              ? (theme ?? t(`${D}.onAir`))
              : t(`${D}.pitch`)}
        </Text>
      </View>

      {/* O que ele disse fica escrito: a voz passa, o bloco dura quatro
          musicas, e a meio ninguem se lembra do que ele prometeu. */}
      {script ? (
        <View
          style={{
            backgroundColor: tokens.secondary,
            borderRadius: RADIUS * 2,
            padding: 16,
            width: "100%",
          }}
        >
          <Text style={{ color: tokens.secondaryForeground, fontSize: 15, lineHeight: 21 }}>
            {script}
          </Text>
        </View>
      ) : null}

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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={active ? t(`${D}.speakNow`) : t(`${D}.start`)}
        disabled={planning}
        onPress={() => (active ? void djStation.again() : void djStation.start())}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          paddingHorizontal: 24,
          paddingVertical: 14,
          borderRadius: 999,
          minWidth: 200,
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
          {active ? t(`${D}.speakNow`) : t(`${D}.start`)}
        </Text>
      </Pressable>

      {/* O pedido e a mesma porta do assistente: escrever o que se quer
          ouvir. Vazio, o botao acima ja basta. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, width: "100%" }}>
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

      {active ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(`${D}.stop`)}
          onPress={() => djStation.stop()}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: 8 })}
        >
          <Text style={{ color: tokens.mutedForeground, fontSize: 13, fontWeight: "700" }}>
            {t(`${D}.stop`)}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
