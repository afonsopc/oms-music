/**
 * O único aspecto de erro (o mesmo do PageState em ui/page.tsx): ícone
 * cinzento, "Não foi possível carregar." (ou a frase dada) e "Tentar de
 * novo". Sem vermelho a gritar: o erro é informação, não alarme.
 */
import React from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "./icons";
import { Reveal } from "./motion";
import { pageType, TextButton } from "./page";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";

export interface ErrorStateProps {
  text?: string;
  onRetry?: () => void;
  retryLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export const ErrorState = ({ text, onRetry, retryLabel, style }: ErrorStateProps) => {
  const { tokens } = useTheme();
  const t = useT();
  return (
    <Reveal>
      <View style={[{ alignItems: "center", gap: 14, paddingVertical: 48, paddingHorizontal: 24 }, style]}>
        <Icon name="alert-circle" size={28} color={tokens.mutedForeground} />
        <Text style={[pageType.body, { color: tokens.foreground, textAlign: "center" }]}>
          {text ?? t("native.common.loadFailed")}
        </Text>
        {onRetry ? (
          <TextButton label={retryLabel ?? t("native.common.tryAgain")} onPress={onRetry} />
        ) : null}
      </View>
    </Reveal>
  );
};
