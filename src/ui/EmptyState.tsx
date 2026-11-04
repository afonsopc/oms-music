/**
 * O único aspecto de "vazio" (o mesmo do PageState em ui/page.tsx): ícone
 * cinzento, uma frase, e no máximo uma acção. Entra a aparecer.
 */
import React from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "./icons";
import { Reveal } from "./motion";
import { pageType, TextButton } from "./page";
import { useTheme } from "@/theme/provider";

export interface EmptyStateProps {
  icon?: IconName;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export const EmptyState = ({ icon = "music", text, actionLabel, onAction, style }: EmptyStateProps) => {
  const { tokens } = useTheme();
  return (
    <Reveal>
      <View style={[{ alignItems: "center", gap: 14, paddingVertical: 48, paddingHorizontal: 24 }, style]}>
        <Icon name={icon} size={28} color={tokens.mutedForeground} />
        <Text style={[pageType.body, { color: tokens.mutedForeground, textAlign: "center" }]}>{text}</Text>
        {actionLabel && onAction ? <TextButton label={actionLabel} onPress={onAction} /> : null}
      </View>
    </Reveal>
  );
};
