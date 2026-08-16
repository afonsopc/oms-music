/**
 * O cabeçalho partilhado das tabs (pedido do dono, 2026-08-18, com
 * screenshots do Spotify): o avatar SEMPRE à esquerda, e à direita só muda
 * a parte de cada tab - as pills de filtro na Home, o título nas outras.
 * Antes disto cada ecrã inventava o seu topo (a Home tinha a marca à
 * esquerda e o avatar à direita; a Biblioteca o contrário), e a app perdia
 * exactamente a consistência que faz o padrão do Spotify parecer "sempre
 * igual". O wordmark Druk Wide saiu da Home com esta troca - o pedido novo
 * substitui o de 2026-08-16.
 *
 * No shell desktop o HeaderAvatar já devolve null (o avatar vive na
 * topbar), portanto a linha degrada para título/pills simples sem caso
 * especial aqui.
 */
import React from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme/provider";
import { typeScale } from "@/theme/typography";
import { HeaderAvatar } from "./HeaderAvatar";

export const TabHeader = ({
  title,
  children,
  style,
}: {
  /** O título da tab; ignorado quando há children (o caso das pills). */
  title?: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) => {
  const { tokens } = useTheme();
  return (
    <View
      style={[
        { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 24 },
        style,
      ]}
    >
      <HeaderAvatar />
      {children ? (
        <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
      ) : title ? (
        <Text
          style={[typeScale.sectionHeader, { color: tokens.foreground, flexShrink: 1 }]}
          numberOfLines={1}
        >
          {title}
        </Text>
      ) : null}
    </View>
  );
};
