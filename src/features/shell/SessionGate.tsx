/**
 * SessionGate (FR-9 UI half). Runs the boot sequence (stored token ->
 * /sessions/mine -> /users/:id) behind the native splash screen and only
 * mounts the navigator once the status is resolved, so a kill/relaunch with a
 * valid token lands authed without flicker. The (auth) vs (main) switch
 * itself happens in the root layout's Stack.Protected guards, which read the
 * same session store.
 */
import React, { useEffect } from "react";
import * as SplashScreen from "expo-splash-screen";
import { bootSession, useSessionStore } from "@/auth/session";

let bootStarted = false;

export const SessionGate = ({ children }: { children: React.ReactNode }) => {
  const status = useSessionStore((s) => s.status);

  useEffect(() => {
    if (!bootStarted) {
      bootStarted = true;
      void bootSession();
    }
  }, []);

  useEffect(() => {
    if (status !== "booting") {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [status]);

  if (status === "booting") return null;
  return <>{children}</>;
};
