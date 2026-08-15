/**
 * O avatar no canto do cabecalho - a porta para /account (perfil, amigos,
 * transferencias, definicoes).
 *
 * E aqui que ele vive desde 2026-08-16, depois de duas tentativas falhadas
 * de o por na barra de tabs: como item falso que abria uma gaveta, e como
 * quarta tab. A barra nativa nao mascara imagens (saia sempre quadrado) e
 * uma tab so para isto e peso morto. O Spotify e o Apple Music poem-no
 * exactamente aqui, no cabecalho dos ecras.
 *
 * No shell desktop nao renderiza: la o avatar ja esta na topbar
 * (features/shell/desktop/AccountMenu) e dois seriam um a mais.
 */
import React from "react";
import { Pressable } from "react-native";
import { useRouter } from "expo-router";
import { avatarUrl } from "@/api/mediaUrl";
import { useSessionStore } from "@/auth/session";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, Icon, useDesktopShell } from "@/ui";

export const HEADER_AVATAR_SIZE = 32;

export const HeaderAvatar = () => {
  const t = useT();
  const router = useRouter();
  const { tokens } = useTheme();
  const desktop = useDesktopShell();
  const userId = useSessionStore((s) => s.user?.id ?? s.session?.user_id ?? null);

  if (desktop) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("native.shell.tabProfile")}
      hitSlop={10}
      onPress={() => router.push("/account")}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {userId ? (
        <ArtworkImage uri={avatarUrl(userId)} size={HEADER_AVATAR_SIZE} shape="circle" />
      ) : (
        <Icon name="user" size={22} color={tokens.foreground} />
      )}
    </Pressable>
  );
};
