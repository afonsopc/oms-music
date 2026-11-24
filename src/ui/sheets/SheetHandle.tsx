/** The bar at the top of a sheet: 24 px tall to be grabbed, 4 px drawn. */
import React from "react";
import { View } from "react-native";
import { useTheme } from "@/theme/provider";

export const SheetHandle = () => {
  const { tokens } = useTheme();
  return (
    <View style={{ height: 24, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: tokens.mutedForeground, opacity: 0.5 }} />
    </View>
  );
};
