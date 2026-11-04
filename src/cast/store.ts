/**
 * O estado da transmissão, lido pelo leitor ("A tocar em Sala (Chromecast)"),
 * pela lista Transmitir e pela projecção remote/mirror.ts. Escrito só pela
 * sessão (./session.ts) e pelos drivers através dela.
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { CastKind, CastTarget } from "./types";

export type CastPhase = "idle" | "connecting" | "connected";

export interface CastStoreState {
  phase: CastPhase;
  kind: CastKind | null;
  deviceName: string | null;
  playing: boolean;
  buffering: boolean;
  /** Segundos, na altura `positionAt` (ms). O ticker estima o resto. */
  position: number;
  positionAt: number;
  duration: number;
  volume: number;
  currentKey: string | null;
  /** Último erro para mostrar uma vez (pt-PT já traduzido pela UI). */
  error: "load_failed" | "connect_failed" | null;
  /** Destinos encontrados na rede (DLNA no computador, Cast nativo). */
  targets: CastTarget[];
  /** Há Chromecast por perto/disponível (web: o Chrome diz; nativo: descoberta). */
  chromecastAvailable: boolean;
  /** AirPlay disponível (Safari/iOS). */
  airplayAvailable: boolean;
  /** O som deste aparelho está a sair por AirPlay (o leitor continua cá). */
  airplayRoute: string | null;
}

export const initialCastState: CastStoreState = {
  phase: "idle",
  kind: null,
  deviceName: null,
  playing: false,
  buffering: false,
  position: 0,
  positionAt: 0,
  duration: 0,
  volume: 1,
  currentKey: null,
  error: null,
  targets: [],
  chromecastAvailable: false,
  airplayAvailable: false,
  airplayRoute: null,
};

export const castStore = createStore<CastStoreState>()(() => ({ ...initialCastState }));

export const useCastStore = <T>(selector: (state: CastStoreState) => T): T =>
  useStore(castStore, selector);

/** A TV tem o som (Chromecast/DLNA). O AirPlay não conta: o leitor é cá. */
export const isCasting = (s: CastStoreState = castStore.getState()): boolean => s.phase !== "idle";

/** Posição estimada agora, a partir da última leitura. */
export const castPositionNow = (s: CastStoreState, now: number = Date.now()): number => {
  if (!s.playing || s.buffering || s.positionAt === 0) return s.position;
  const est = s.position + (now - s.positionAt) / 1000;
  return s.duration > 0 ? Math.min(s.duration, est) : est;
};

const KIND_LABEL: Record<CastKind, string> = {
  chromecast: "Chromecast",
  airplay: "AirPlay",
  dlna: "TV",
};

/** "Sala (Chromecast)"; só o tipo quando o nome não chegou. */
export const castDeviceLabel = (name: string | null, kind: CastKind | null): string => {
  const k = kind ? KIND_LABEL[kind] : "";
  if (!name) return k;
  if (!k || name.toLowerCase().includes(k.toLowerCase())) return name;
  return `${name} (${k})`;
};
