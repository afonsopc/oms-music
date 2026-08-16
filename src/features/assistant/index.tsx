/**
 * "O Melhor Assistente" (3.8, dono 2026-08-17/18): chat que responde sobre
 * os hábitos de escuta e cria playlists. O cliente é deliberadamente burro:
 * guarda o histórico da sessão, envia-o inteiro em cada POST e desenha o
 * que voltar - toda a inteligência e TODA a validação vivem no servidor
 * (o modelo propõe ids, o backend confirma-os; ver a proposta). Sem o diff
 * do backend aplicado o POST responde 404 e o ecrã di-lo em vez de fingir.
 */
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  askAssistant,
  type AssistantAnswer,
  type AssistantMessage,
} from "@/api/endpoints/assistant";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { playlistRoute } from "@/lib/routes";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { Icon } from "@/ui";

const A = "components.music.Assistant";

interface Bubble {
  role: "user" | "assistant";
  content: string;
  playlist?: AssistantAnswer["playlist"];
  error?: boolean;
}

export default function AssistantScreen() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useTheme();
  const topPadding = useContentTopPadding(12);
  const bottomPadding = useContentBottomPadding();

  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const send = useCallback(
    (raw: string): void => {
      const content = raw.trim();
      if (!content || pending) return;
      setInput("");
      setPending(true);
      const history: AssistantMessage[] = [
        ...bubbles
          .filter((b) => !b.error)
          .map((b) => ({ role: b.role, content: b.content })),
        { role: "user", content },
      ];
      setBubbles((prev) => [...prev, { role: "user", content }]);
      askAssistant(history)
        .then((answer) => {
          setBubbles((prev) => [
            ...prev,
            { role: "assistant", content: answer.reply, playlist: answer.playlist ?? null },
          ]);
        })
        .catch(() => {
          setBubbles((prev) => [
            ...prev,
            { role: "assistant", content: t(`${A}.error`), error: true },
          ]);
        })
        .finally(() => {
          setPending(false);
          scrollRef.current?.scrollToEnd({ animated: true });
        });
    },
    [bubbles, pending, t],
  );

  const suggestions = [
    t(`${A}.suggestionPlaylist`),
    t(`${A}.suggestionHabits`),
    t(`${A}.suggestionForgotten`),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: topPadding,
          paddingBottom: 16,
          paddingHorizontal: 16,
          gap: 10,
        }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        <Text style={{ color: tokens.foreground, fontSize: 28, fontWeight: "900", letterSpacing: -0.5 }}>
          {t(`${A}.title`)}
        </Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 14, lineHeight: 20 }}>
          {t(`${A}.subtitle`)}
        </Text>

        {bubbles.length === 0 ? (
          <View style={{ gap: 8, marginTop: 12 }}>
            {suggestions.map((suggestion) => (
              <Pressable
                key={suggestion}
                accessibilityRole="button"
                onPress={() => send(suggestion)}
                style={({ pressed }) => ({
                  alignSelf: "flex-start",
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 999,
                  backgroundColor: tokens.secondary,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: tokens.secondaryForeground, fontSize: 13 }}>
                  {suggestion}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {bubbles.map((bubble, i) => (
          <View
            key={`b-${i}`}
            style={{
              alignSelf: bubble.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              gap: 6,
            }}
          >
            <View
              style={{
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 16,
                backgroundColor:
                  bubble.role === "user"
                    ? tokens.primary
                    : bubble.error
                      ? tokens.destructive
                      : tokens.secondary,
              }}
            >
              <Text
                style={{
                  color:
                    bubble.role === "user"
                      ? tokens.primaryForeground
                      : bubble.error
                        ? tokens.destructiveForeground
                        : tokens.foreground,
                  fontSize: 14,
                  lineHeight: 20,
                }}
              >
                {bubble.content}
              </Text>
            </View>
            {bubble.playlist ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(playlistRoute(bubble.playlist!.id))}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  padding: 12,
                  borderRadius: RADIUS,
                  borderWidth: 1,
                  borderColor: tokens.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Icon name="list-music" size={18} color={tokens.primary} />
                <View style={{ flexShrink: 1, minWidth: 0 }}>
                  <Text
                    style={{ color: tokens.foreground, fontSize: 14, fontWeight: "700" }}
                    numberOfLines={1}
                  >
                    {bubble.playlist.name}
                  </Text>
                  <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
                    {t(`${A}.openPlaylist`, { count: bubble.playlist.song_count })}
                  </Text>
                </View>
                <Icon name="chevron-right" size={16} color={tokens.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
        ))}
        {pending ? (
          <View style={{ alignSelf: "flex-start", padding: 10 }}>
            <ActivityIndicator color={tokens.mutedForeground} />
          </View>
        ) : null}
      </ScrollView>

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
          value={input}
          onChangeText={setInput}
          placeholder={t(`${A}.placeholder`)}
          placeholderTextColor={tokens.mutedForeground}
          onSubmitEditing={() => send(input)}
          editable={!pending}
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
          accessibilityLabel={t(`${A}.send`)}
          onPress={() => send(input)}
          disabled={pending || input.trim().length === 0}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: tokens.primary,
            opacity: pending || input.trim().length === 0 ? 0.4 : pressed ? 0.7 : 1,
          })}
        >
          <Icon name="chevron-right" size={18} color={tokens.primaryForeground} />
        </Pressable>
      </View>
    </View>
  );
}
