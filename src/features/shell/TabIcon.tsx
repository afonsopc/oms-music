/**
 * Dependency-free tab icons. No icon font ships with the project (installing
 * one needs approval), so the four tab glyphs are drawn with plain Views:
 * they tint with the color the tab bar passes and render identically on both
 * platforms.
 */
import React from "react";
import { View, type ColorValue } from "react-native";

export type TabIconName = "home" | "search" | "library" | "downloads";

interface TabIconProps {
  name: TabIconName;
  color: ColorValue;
  size?: number;
}

const HomeIcon = ({ color }: { color: ColorValue }) => (
  <View style={{ width: 24, height: 24, alignItems: "center", justifyContent: "flex-end" }}>
    <View
      style={{
        width: 0,
        height: 0,
        borderLeftWidth: 9,
        borderRightWidth: 9,
        borderBottomWidth: 8,
        borderLeftColor: "transparent",
        borderRightColor: "transparent",
        borderBottomColor: color,
      }}
    />
    <View
      style={{
        width: 12,
        height: 9,
        marginTop: 1,
        marginBottom: 3,
        borderBottomLeftRadius: 2,
        borderBottomRightRadius: 2,
        backgroundColor: color,
      }}
    />
  </View>
);

const SearchIcon = ({ color }: { color: ColorValue }) => (
  <View style={{ width: 24, height: 24 }}>
    <View
      style={{
        position: "absolute",
        top: 3,
        left: 3,
        width: 13,
        height: 13,
        borderRadius: 7,
        borderWidth: 2,
        borderColor: color,
      }}
    />
    <View
      style={{
        position: "absolute",
        bottom: 5,
        right: 3,
        width: 8,
        height: 2.5,
        borderRadius: 1.5,
        backgroundColor: color,
        transform: [{ rotate: "45deg" }],
      }}
    />
  </View>
);

const LibraryIcon = ({ color }: { color: ColorValue }) => (
  <View style={{ width: 24, height: 24 }}>
    <View
      style={{
        position: "absolute",
        top: 4,
        left: 5,
        width: 2.5,
        height: 16,
        borderRadius: 1,
        backgroundColor: color,
      }}
    />
    <View
      style={{
        position: "absolute",
        top: 4,
        left: 10,
        width: 2.5,
        height: 16,
        borderRadius: 1,
        backgroundColor: color,
      }}
    />
    <View
      style={{
        position: "absolute",
        top: 4,
        left: 15.5,
        width: 3.5,
        height: 16,
        borderRadius: 1,
        backgroundColor: color,
        transform: [{ rotate: "12deg" }],
      }}
    />
  </View>
);

const DownloadsIcon = ({ color }: { color: ColorValue }) => (
  <View style={{ width: 24, height: 24, alignItems: "center" }}>
    <View style={{ width: 2.5, height: 10, marginTop: 3, borderRadius: 1, backgroundColor: color }} />
    <View style={{ width: 24, height: 6 }}>
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 5.5,
          width: 8,
          height: 2.5,
          borderRadius: 1.5,
          backgroundColor: color,
          transform: [{ rotate: "45deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          top: 0,
          right: 5.5,
          width: 8,
          height: 2.5,
          borderRadius: 1.5,
          backgroundColor: color,
          transform: [{ rotate: "-45deg" }],
        }}
      />
    </View>
    <View style={{ width: 15, height: 2.5, marginTop: 1, borderRadius: 1.5, backgroundColor: color }} />
  </View>
);

export const TabIcon = ({ name, color, size = 24 }: TabIconProps) => {
  const scale = size / 24;
  const icon =
    name === "home" ? (
      <HomeIcon color={color} />
    ) : name === "search" ? (
      <SearchIcon color={color} />
    ) : name === "library" ? (
      <LibraryIcon color={color} />
    ) : (
      <DownloadsIcon color={color} />
    );
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        transform: [{ scale }],
      }}
    >
      {icon}
    </View>
  );
};
