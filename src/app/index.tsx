/** "/" -> Home when authed, login otherwise (the guards enforce the rest). */
import React from "react";
import { Redirect } from "expo-router";
import { useSessionStore } from "@/auth/session";

export default function Index() {
  const status = useSessionStore((s) => s.status);
  return <Redirect href={status === "authed" ? "/(main)/(tabs)/home" : "/(auth)/login"} />;
}
