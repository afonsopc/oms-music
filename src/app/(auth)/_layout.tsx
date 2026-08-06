import React from "react";
import { Stack } from "expo-router";
import { useTheme } from "@/theme/provider";

export const unstable_settings = { initialRouteName: "login" };

export default function AuthLayout() {
  const { tokens } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: tokens.background },
      }}
    />
  );
}
