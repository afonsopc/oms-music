/**
 * "O Melhor DJ" - a estacao (dono, 2026-08-31). O DJ deixou de ser um botao
 * que falava e saltava de musica: passou a CONDUZIR a sessao. Pede ao
 * servidor um set (quatro musicas com um fio comum + as palavras que as
 * apresentam), mete a voz na fila COMO SE FOSSE UMA MUSICA e a seguir as
 * musicas, e quando falta uma para acabar pede o set seguinte.
 *
 * A voz vai na fila de proposito. Toca-la por fora obrigava a pausar a
 * musica, falar e retomar - era isso que fazia o "salto" da primeira
 * versao. Na fila, o motor encadeia voz e musica com o mesmo leitor e a
 * passagem soa a radio. O que a torna especial (sem scrub, sem play, sem
 * download, sem cabo) esta na guarda unica `isDjClip` - ver domain/song.ts.
 *
 * O servidor nao guarda sessao: e daqui que vao os recentes (para nao
 * repetir), os saltados (sinal negativo) e o que ele ja disse (para nao
 * abrir todos os sets com a mesma frase).
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { MusicDjBatch } from "@omelhorsite/sdk";
import { oms } from "@/api/oms";
import { getTransport } from "@/contracts/transport";
import type { SongId } from "@/domain/ids";
import type { Song } from "@/domain/song";
import { isDjClip } from "@/domain/song";
import { playerStore } from "@/player/store";
import { getPlaybackView } from "@/remote/mirror";
import { writeDjClip, type DjVoiceClip } from "./clip";

/** Com uma musica por tocar ja da tempo de planear sem o silencio se notar. */
const REFILL_WHEN_LEFT = 1;
/** Abaixo de metade ouvida, foi salto - e o salto e sinal para o DJ. */
const SKIP_RATIO = 0.5;
const RECENT_MEMORY = 60;
const SKIPPED_MEMORY = 20;
const SPOKEN_MEMORY = 3;
/** Falhar nao pode virar martelo: o leitor emite estado a 4 Hz. */
const RETRY_COOLDOWN_MS = 30_000;
/** Clips guardados em disco de cada vez. Os antigos ja tocaram. */
const CLIP_MEMORY = 4;

export interface DjStationState {
  /** A sessao esta a decorrer (o DJ manda na fila). */
  active: boolean;
  /** A pedir um set ao servidor. */
  planning: boolean;
  error: string | null;
  /**
   * A estacao nao pode correr daqui: este dispositivo esta a COMANDAR outro
   * (modo controlador). A voz e um ficheiro local e os ids sao sinteticos -
   * nada disto atravessa o cabo.
   */
  remote: boolean;
  /** O que o bloco a tocar e, em duas a cinco palavras. */
  theme: string | null;
  /** As palavras da ultima intervencao, para a pagina as mostrar. */
  script: string | null;
  /** O clip do DJ e a "musica" actual: ele esta mesmo a falar agora. */
  speaking: boolean;
  /** Quantos sets ja foram, para o guiao variar a abertura. */
  sets: number;
}

const initial: DjStationState = {
  active: false,
  planning: false,
  error: null,
  remote: false,
  theme: null,
  script: null,
  speaking: false,
  sets: 0,
};

export const djStore = createStore<DjStationState>(() => initial);

export const useDjStation = <T,>(selector: (s: DjStationState) => T): T =>
  useStore(djStore, selector);

/** Ids sinteticos, sempre negativos: nenhuma musica real colide com eles. */
let clipSeq = 0;

const djClipSong = (batch: MusicDjBatch, uri: string): Song => {
  const now = new Date().toISOString();
  return {
    id: (--clipSeq) as SongId,
    created_at: now,
    updated_at: now,
    title: batch.theme ?? "O Melhor DJ",
    album: null,
    // Zero ate o leitor ler o ficheiro: a duracao real vem do audio, e a
    // barra nunca aparece para um clip destes.
    duration: 0,
    position: null,
    year: null,
    audio_media_id: null,
    compressed_audio_media_id: null,
    artwork_media_id: null,
    compressed_artwork_media_id: null,
    vocals_media_id: null,
    instrumental_media_id: null,
    vocal_separation_started_at: null,
    user_id: "",
    source_kind: null,
    source_provider: null,
    source_url: null,
    source_id: null,
    isrc: null,
    original_filename: null,
    audio_codec: null,
    audio_bitrate_kbps: null,
    audio_sample_rate_hz: null,
    audio_channels: null,
    audio_lossless: null,
    audio_filesize_bytes: null,
    artists: [],
    audio_url: uri,
    artist_names: "O Melhor DJ",
    dj_clip: { theme: batch.theme, script: batch.text },
  };
};

class Station {
  private unsubscribe: (() => void) | null = null;
  private planning = false;
  private blockedUntil = 0;
  private recent: SongId[] = [];
  private skipped: SongId[] = [];
  private spoken: string[] = [];
  private clips: DjVoiceClip[] = [];
  /** Os ids que ESTA sessao meteu na fila. Ver `onPlayerState`. */
  private owned = new Set<number>();
  private watching: { id: SongId; position: number; duration: number } | null = null;

  /** Comeca (ou reinicia) a sessao: o primeiro set substitui a fila. */
  async start(request?: string): Promise<void> {
    if (getPlaybackView().passive) {
      djStore.setState({ remote: true });
      return;
    }
    djStore.setState({ active: true, error: null, remote: false, sets: 0 });
    this.recent = [];
    this.skipped = [];
    this.spoken = [];
    this.owned = new Set();
    this.watch();
    await this.plan({ replace: true, request });
  }

  /**
   * O botao do DJ a meio da sessao: ele fala JA e traz outro bloco. Com
   * pedido e "muda a vibe"; sem pedido e "diz-me o que vem ai".
   */
  async again(request?: string): Promise<void> {
    if (!djStore.getState().active) return this.start(request);
    this.blockedUntil = 0;
    await this.plan({ replace: true, request });
  }

  stop(): void {
    djStore.setState({ ...initial });
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.watching = null;
    // Sair a meio de uma frase e pior do que sair: se ele esta a falar,
    // salta-se o clip antes de o ficheiro desaparecer debaixo do leitor.
    if (isDjClip(playerStore.getState().currentSong)) getTransport().next();
    for (const clip of this.clips) clip.release();
    this.clips = [];
  }

  private watch(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = playerStore.subscribe(() => this.onPlayerState());
  }

  private onPlayerState(): void {
    const state = playerStore.getState();
    if (!djStore.getState().active) return;

    const song = state.currentSong;
    // O ouvinte pegou na fila (abriu um album, tocou uma playlist): a
    // estacao sai de cena em vez de continuar a empurrar sets por cima do
    // que ele escolheu. Uma radio que se recusa a calar e uma avaria.
    if (song && !isDjClip(song) && !this.owned.has(song.id as number)) {
      this.stop();
      return;
    }

    const speaking = isDjClip(song);
    if (speaking !== djStore.getState().speaking) {
      djStore.setState(
        speaking && song?.dj_clip
          ? { speaking, theme: song.dj_clip.theme, script: song.dj_clip.script }
          : { speaking },
      );
    }

    this.trackProgress(song, state.position, state.duration);

    const left = state.queueOrder.length - 1 - state.queueIndex;
    if (left <= REFILL_WHEN_LEFT) void this.plan({ replace: false });
  }

  /**
   * Quem mudou de musica antes de metade saltou-a. Sem isto o DJ nao tem
   * como saber que a direccao esta errada - e o servidor conta com o sinal.
   */
  private trackProgress(song: Song | null, position: number, duration: number): void {
    if (!song) return;
    const watching = this.watching;
    if (watching && watching.id === song.id) {
      this.watching = {
        id: song.id,
        position: Math.max(watching.position, position),
        duration: duration > 0 ? duration : watching.duration,
      };
      return;
    }
    if (watching && !this.isClipId(watching.id)) {
      this.recent = [...this.recent, watching.id].slice(-RECENT_MEMORY);
      const heard = watching.duration > 0 ? watching.position / watching.duration : 1;
      if (heard < SKIP_RATIO) this.skipped = [...this.skipped, watching.id].slice(-SKIPPED_MEMORY);
    }
    this.watching = { id: song.id, position, duration };
  }

  private isClipId(id: SongId): boolean {
    return (id as number) < 0;
  }

  private async plan(opts: { replace: boolean; request?: string }): Promise<void> {
    if (this.planning || Date.now() < this.blockedUntil) return;
    this.planning = true;
    djStore.setState({ planning: true, error: null });
    try {
      const batch = await oms().music.social.dj.batch({
        request: opts.request,
        recentSongIds: this.recent,
        skippedSongIds: this.skipped,
        batchIndex: djStore.getState().sets,
        spokenBefore: this.spoken,
      });
      this.enqueue(batch, opts.replace);
    } catch (error) {
      // O leitor emite a 4 Hz: sem tranca, uma falha vira uma chamada por
      // cada tique. O ecra mostra o erro e o botao volta a estar la.
      this.blockedUntil = Date.now() + RETRY_COOLDOWN_MS;
      djStore.setState({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.planning = false;
      djStore.setState({ planning: false });
    }
  }

  private enqueue(batch: MusicDjBatch, replace: boolean): void {
    const clip = writeDjClip(batch.audio_base64, batch.format);
    // Os clips antigos ja tocaram; guardar a sessao inteira em disco era
    // so lixo na cache.
    const stale = [...this.clips, clip].slice(0, -CLIP_MEMORY);
    for (const old of stale) old.release();
    this.clips = [...this.clips, clip].slice(-CLIP_MEMORY);
    const voice = djClipSong(batch, clip.uri);
    // As musicas vem serializadas pelo servidor no mesmo formato de
    // GET /songs; o Song do SDK e o fio, o do dominio marca os ids.
    const songs = batch.songs as unknown as Song[];
    for (const song of songs) this.owned.add(song.id as number);
    const transport = getTransport();
    if (replace) transport.setQueue([ voice, ...songs ], 0);
    else {
      transport.addToQueue(voice);
      for (const song of songs) transport.addToQueue(song);
    }
    this.spoken = [...this.spoken, batch.text].slice(-SPOKEN_MEMORY);
    djStore.setState({
      theme: batch.theme,
      script: batch.text,
      sets: djStore.getState().sets + 1,
    });
  }
}

export const djStation = new Station();
