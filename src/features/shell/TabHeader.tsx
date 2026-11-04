/**
 * O cabeçalho partilhado das tabs (pedido do dono, 2026-08-18, com
 * screenshots das apps de referencia): o avatar SEMPRE à esquerda, e à direita só muda
 * a parte de cada tab - as pills de filtro na Home, o título nas outras.
 * Antes disto cada ecrã inventava o seu topo (a Home tinha a marca à
 * esquerda e o avatar à direita; a Biblioteca o contrário), e a app perdia
 * exactamente a consistência que faz o padrão das apps de referencia parecer "sempre
 * igual". O wordmark Druk Wide saiu da Home com esta troca - o pedido novo
 * substitui o de 2026-08-16.
 *
 * No shell desktop o HeaderAvatar já devolve null (o avatar vive na
 * topbar), portanto a linha degrada para título/pills simples sem caso
 * especial aqui.
 */
import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { PageTitle, useGutter } from "@/ui/page";
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
  const gutter = useGutter();
  return (
    <View
      style={[
        { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: gutter, minHeight: 44 },
        style,
      ]}
    >
      <HeaderAvatar />
      {children ? (
        <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
      ) : title ? (
        <View style={{ flex: 1, minWidth: 0 }}>
          <PageTitle>{title}</PageTitle>
        </View>
      ) : null}
    </View>
  );
};
