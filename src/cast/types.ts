/**
 * Transmitir (Chromecast, AirPlay, TVs DLNA). Um "driver" por tecnologia;
 * a sessão (./session.ts) é a mesma para todos: a fila continua a ser a do
 * motor, o som passa a estar na TV, e os botões da app mandam na TV.
 */

export type CastKind = "chromecast" | "airplay" | "dlna";

/** Uma música pronta para a TV: URLs assinados, nunca o token da sessão. */
export interface CastItem {
  /** String(song.id): é por aqui que a app sabe que música a TV tem. */
  key: string;
  url: string;
  contentType: string;
  title: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
  /** Segundos (o da música; a TV diz o verdadeiro quando carrega). */
  duration: number;
  /** Vai no customData (o receptor próprio lê: songId, tags, bpm, viz). */
  custom?: Record<string, unknown>;
}

/** O que a TV diz de si, a cada mudança. Campos ausentes não mudaram. */
export interface CastStatus {
  playing?: boolean;
  buffering?: boolean;
  /** Segundos. */
  position?: number;
  duration?: number;
  /** Item que a TV tem agora (CastItem.key). */
  currentKey?: string | null;
  /** 0..1 */
  volume?: number;
  /** A TV acabou a música e não tem mais nada (fila só da app). */
  finished?: boolean;
}

export interface CastDriverEvents {
  onStatus(status: CastStatus): void;
  /** A sessão acabou do lado de lá (TV desligada, outro telemóvel, rede). */
  onEnded(): void;
}

export interface CastDriver {
  readonly kind: CastKind;
  readonly deviceName: string;
  /**
   * A TV guarda a fila e passa de música sozinha (Chromecast). Sem isto
   * (DLNA) é a app que manda a seguinte quando a TV acaba.
   */
  readonly nativeQueue: boolean;
  /** Quantos itens a TV aceita de uma vez (1 sem fila nativa). */
  readonly maxItems: number;
  load(items: CastItem[], startIndex: number, position: number, autoplay: boolean): Promise<void>;
  /** Fila nativa: troca o que vem depois da actual, sem a interromper. */
  replaceUpcoming?(items: CastItem[]): Promise<void>;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  next?(): void;
  previous?(): void;
  setVolume(volume: number): void;
  /** Acaba a sessão. `stopTv`: parar o som lá (Tocar aqui) ou deixá-la. */
  end(stopTv: boolean): void;
}

/** Um destino na lista "Transmitir". */
export interface CastTarget {
  id: string;
  kind: CastKind;
  name: string;
  /** Modelo/fabricante, quando a descoberta o diz. */
  detail?: string | null;
}
