/**
 * Placeholder scaffold (WP2). Owned by WP11, which replaces this file
 * wholesale. Deliberately self-contained: no imports from src/** so the
 * scaffold compiles standalone.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

export default function ImportScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>import - not built yet (WP11)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  label: { opacity: 0.5, textAlign: "center" },
});
