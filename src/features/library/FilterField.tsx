/**
 * The one filter field of the library screens (Biblioteca, Artistas): a
 * quiet grey strip on the page gutter, 40 px, a lupa and a clear cross.
 * Same shape on both so the two lists read as one family.
 */
import React from "react";
import { Pressable, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/provider";
import { Icon } from "@/ui";
import { useGutter } from "@/ui/page";

export const FilterField = ({
  value,
  onChangeText,
  placeholder,
  clearLabel,
  style,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  clearLabel: string;
  style?: StyleProp<ViewStyle>;
}) => {
  const { tokens } = useTheme();
  const gutter = useGutter();
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          marginHorizontal: gutter,
          paddingHorizontal: 12,
          height: 40,
          borderRadius: 8,
          backgroundColor: tokens.secondary,
        },
        style,
      ]}
    >
      <Icon name="search" size={16} color={tokens.mutedForeground} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={tokens.mutedForeground}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityLabel={placeholder}
        style={{ flex: 1, minWidth: 0, color: tokens.foreground, fontSize: 15, paddingVertical: 0 }}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => {
            haptics.select();
            onChangeText("");
          }}
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          hitSlop={10}
        >
          <Icon name="x" size={15} color={tokens.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
};
