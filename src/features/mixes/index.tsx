/**
 * Placeholder scaffold (WP2). Owned by WP6, which replaces this file
 * wholesale. Deliberately self-contained: no imports from src/** so the
 * scaffold compiles standalone.
 */
import { useLocalSearchParams } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

export default function MixScreen() {
  const params = useLocalSearchParams();
  return (
    <View style={styles.container}>
      <Text style={styles.label}>mixes - not built yet (WP6)</Text>
      <Text style={styles.params}>{JSON.stringify(params)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  label: { opacity: 0.5, textAlign: "center" },
  params: { opacity: 0.35, marginTop: 8, fontSize: 12, textAlign: "center" },
});
