/** "/" -> Home when authed, login otherwise (the guards enforce the rest). */
import React from "react";
import { Redirect } from "expo-router";
import { useSessionStore } from "@/auth/session";

export default function Index() {
  const status = useSessionStore((s) => s.status);
  // Href nu de proposito: com stacks por tab a Home vive em
  // (main)/(tabs)/(home)/home, e o expo-router resolve "/home" para a copia
  // certa sozinho (so existe uma). Prefixar o grupo aqui era duplicar uma
  // arvore que ja mudou uma vez.
  return <Redirect href={status === "authed" ? "/home" : "/(auth)/login"} />;
}
