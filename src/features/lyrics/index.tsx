/**
 * Placeholder scaffold (WP2). Owned by WP7, which replaces this file
 * wholesale. Deliberately self-contained: no imports from src/** so the
 * scaffold compiles standalone.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

export default function LyricsBody() {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>lyrics - not built yet (WP7)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  label: { opacity: 0.5, textAlign: "center" },
});
