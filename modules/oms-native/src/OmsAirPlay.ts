/**
 * AirPlay no iOS (ios/OmsAirPlayModule.swift): a rota de áudio actual e o
 * selector de saídas do sistema. Opcional, como o resto do módulo: sem ele
 * (Android, web, builds antigos) não há linha AirPlay.
 */
import type { ComponentType } from "react";
import type { ViewProps } from "react-native";
import { requireNativeView, requireOptionalNativeModule } from "expo";

export interface AudioRoute {
  kind: "airplay" | "bluetooth" | "other" | "local";
  name: string;
}

interface OmsAirPlayNative {
  currentRoute(): AudioRoute;
  addListener(event: "routeChanged", cb: (route: AudioRoute) => void): { remove(): void };
}

const native = requireOptionalNativeModule<OmsAirPlayNative>("OmsAirPlay");

export const isAirPlayPickerAvailable = (): boolean => native !== null;

export const currentAudioRoute = (): AudioRoute | null => {
  try {
    return native?.currentRoute() ?? null;
  } catch {
    return null;
  }
};

export const onAudioRouteChange = (cb: (route: AudioRoute) => void): (() => void) => {
  if (!native) return () => undefined;
  const sub = native.addListener("routeChanged", cb);
  return () => sub.remove();
};

export interface RoutePickerProps extends ViewProps {
  tint?: string;
  activeTint?: string;
}

let view: ComponentType<RoutePickerProps> | null | undefined;

/** O AVRoutePickerView, ou null sem o módulo. */
export const getRoutePickerView = (): ComponentType<RoutePickerProps> | null => {
  if (view !== undefined) return view;
  view = native ? (requireNativeView("OmsAirPlay") as ComponentType<RoutePickerProps>) : null;
  return view;
};
