/**
 * Placeholder scaffold (WP2). Owned by WP5, which replaces this file
 * wholesale. Deliberately self-contained: no imports from src/** so the
 * scaffold compiles standalone.
 */
import { useLocalSearchParams } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

export default function SearchScreen() {
  const params = useLocalSearchParams();
  return (
    <View style={styles.container}>
      <Text style={styles.label}>search - not built yet (WP5)</Text>
      <Text style={styles.params}>{JSON.stringify(params)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  label: { opacity: 0.5, textAlign: "center" },
  params: { opacity: 0.35, marginTop: 8, fontSize: 12, textAlign: "center" },
});
