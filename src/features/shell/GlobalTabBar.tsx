/**
 * A barra de tabs GLOBAL do mobile nativo (pedido do dono 2026-08-14): ao
 * estilo Apple Music, a barra vive por cima de TODOS os ecras do (main) -
 * tabs E pushes (playlist, album, definicoes...) - e so desaparece debaixo
 * do player modal, que a cobre por inteiro. A barra do proprio navegador de
 * tabs deixa de renderizar no nativo (ShellTabBar); esta e A barra.
 *
 * Flutuante e em Liquid Glass a serio no iOS 26+ (expo-glass-effect,
 * aprovado pelo dono 2026-08-14); onde o vidro nativo nao existe (Android,
 * iOS < 26) fica a aproximacao translucida: alpha alto + hairline + sombra.
 *
 * Fora das tabs nenhuma rota esta "activa"; como no Apple Music, a barra
 * mantem acesa a ULTIMA tab visitada - dai o memo de modulo, que tambem
 * sobrevive a remounts do layout.
 *
 * So NATIVO: a web abaixo de 900px mantem a barra clssica congelada do
 * shell mobile web, e o desktop tem a sidebar.
 */
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { useRouter, useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { avatarUrl } from "@/api/mediaUrl";
import { useSessionStore } from "@/auth/session";
import { openProfileDrawer } from "@/features/home/ProfileDrawer";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, Icon } from "@/ui";
import { setMeasuredTabBarHeight } from "./metrics";
import { TabIcon, type TabIconName } from "./TabIcon";

const AVATAR_SIZE = 26;

interface TabDef {
  key: TabIconName;
  labelKey: string;
  route: "/(main)/(tabs)/home" | "/(main)/(tabs)/search" | "/(main)/(tabs)/library";
}

const TABS: TabDef[] = [
  { key: "home", labelKey: "native.shell.tabHome", route: "/(main)/(tabs)/home" },
  { key: "search", labelKey: "native.shell.tabSearch", route: "/(main)/(tabs)/search" },
  { key: "library", labelKey: "native.shell.tabLibrary", route: "/(main)/(tabs)/library" },
];


const TabItem = ({
  active,
  label,
  onPress,
  children,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: "center",
        gap: 2,
        paddingVertical: 8,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ height: 26, alignItems: "center", justifyContent: "center" }}>
        {children}
      </View>
      <Text
        style={{
          color: active ? tokens.primary : tokens.mutedForeground,
          fontSize: 10,
          fontWeight: active ? "700" : "500",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
};

export const GlobalTabBar = () => {
  const t = useT();
  const router = useRouter();
  const { tokens, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const segments = useSegments() as string[];
  const userId = useSessionStore((s) => s.user?.id ?? s.session?.user_id ?? null);

  const inTabs = segments.includes("(tabs)");
  const current = TABS.find((tab) => segments.includes(tab.key))?.key;
  // A ultima tab visitada fica acesa durante os pushes (Apple Music): a
  // barra vive montada no (main) inteiro, por isso o estado sobrevive.
  // Adjust-during-render, o padrao do proprio React para estado derivado de
  // navegacao (mesmo idioma do CollectionScreen) - um effect aqui seria um
  // frame atrasado e o compiler recusa setState sincrono em effects.
  const [remembered, setRemembered] = React.useState<TabIconName>("home");
  if (inTabs && current && current !== remembered) {
    setRemembered(current);
  }

  if (Platform.OS === "web") return null;

  const active = inTabs && current ? current : remembered;

  // iOS 26+: Liquid Glass nativo (o glassEffect trata de fundo, refracao e
  // adaptacao ao conteudo por baixo - nada de cores nossas). Resto: a
  // aproximacao de "vidro" quase-opaco derivada do scheme.
  const liquid = isLiquidGlassAvailable();
  const glass =
    scheme === "dark" ? "rgba(22, 22, 24, 0.92)" : "rgba(248, 248, 250, 0.92)";
  const Capsule = liquid ? GlassView : View;

  return (
    <View
      pointerEvents="box-none"
      onLayout={(event) => setMeasuredTabBarHeight(Math.round(event.nativeEvent.layout.height))}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 14,
        paddingBottom: Math.max(insets.bottom - 6, 8),
        paddingTop: 6,
      }}
    >
      <Capsule
        {...(liquid ? { glassEffectStyle: "regular" as const, isInteractive: true } : null)}
        style={{
          flexDirection: "row",
          borderRadius: 26,
          // O vidro nativo pinta-se a si proprio; um backgroundColor por
          // cima mataria o efeito.
          ...(liquid
            ? { overflow: "hidden" as const }
            : {
                backgroundColor: glass,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor:
                  scheme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
              }),
          shadowColor: "#000",
          shadowOpacity: liquid ? 0.15 : 0.25,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 12,
        }}
      >
        {TABS.map((tab) => (
          <TabItem
            key={tab.key}
            active={active === tab.key}
            label={t(tab.labelKey)}
            onPress={() => router.navigate(tab.route)}
          >
            <TabIcon
              name={tab.key}
              color={active === tab.key ? tokens.primary : tokens.mutedForeground}
            />
          </TabItem>
        ))}
        <TabItem active={false} label={t("native.shell.tabProfile")} onPress={openProfileDrawer}>
          {userId ? (
            <ArtworkImage uri={avatarUrl(userId)} size={AVATAR_SIZE} shape="circle" />
          ) : (
            <View
              style={{
                width: AVATAR_SIZE,
                height: AVATAR_SIZE,
                borderRadius: AVATAR_SIZE / 2,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: tokens.secondary,
              }}
            >
              <Icon name="user" size={14} color={tokens.mutedForeground} />
            </View>
          )}
        </TabItem>
      </Capsule>
    </View>
  );
};
