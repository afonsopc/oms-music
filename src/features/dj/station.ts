/**
 * "O Melhor DJ" - a estacao. Uma musica de cada vez (dono, 2026-08-31: "a
 * queue do DJ deve ser sempre 1 musica so, quando ela acaba ou o user da
 * skip ele pensa na proxima com o contexto da sessao").
 *
 * A SESSAO E DO SERVIDOR, como a do assistente: e ele que sabe o que ja
 * tocou (e por isso nunca repete), o que foi saltado, o que ja disse e o que
 * lhe pediram. Este ficheiro so diz o que aconteceu e mete na fila o que
 * vier.
 *
 * A fila CRESCE com a sessao, e nao se limpa: e ela a historia da noite, e e
 * o que faz o botao de voltar atras funcionar sem codigo nenhum. O que se
 * mantem em UM e a frente: ha sempre no maximo uma musica por tocar, pedida
 * quando a actual comeca (para nao haver silencio entre elas).
 *
 * A voz vai na fila como se fosse uma musica; o que a torna especial esta na
 * guarda isDjClip (domain/song.ts).
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { MusicDjNext, MusicDjSession } from "@omelhorsite/sdk";
import { oms } from "@/api/oms";
import { getTransport } from "@/contracts/transport";
import type { SongId } from "@/domain/ids";
import type { LoopMode } from "@/domain/playback";
import type { Song } from "@/domain/song";
import { isDjClip } from "@/domain/song";
import { playerStore } from "@/player/store";
import { getPlaybackView } from "@/remote/mirror";
import { writeDjClip, type DjVoiceClip } from "./clip";

/** Abaixo de metade ouvida, foi salto - e o salto e sinal para o DJ. */
const SKIP_RATIO = 0.5;
/** Falhar nao pode virar martelo: o leitor emite estado a 4 Hz. */
const RETRY_COOLDOWN_MS = 20_000;

/** Uma volta da conversa: o que ele disse, o que pediste, o que tocou. */
export interface DjTurn {
  key: string;
  role: "dj" | "listener";
  text: string | null;
  song: Song | null;
}

export interface DjStationState {
  /** A estacao esta a decorrer (o DJ manda na fila). */
  active: boolean;
  /** A pedir a proxima musica ao servidor. */
  planning: boolean;
  error: string | null;
  /**
   * Nao da para correr daqui: este aparelho esta a COMANDAR outro. A voz e
   * um ficheiro local e os ids do clip sao sinteticos.
   */
  remote: boolean;
  /** O que este bloco e, em duas a cinco palavras. */
  theme: string | null;
  /** O clip do DJ e a "musica" actual: ele esta mesmo a falar agora. */
  speaking: boolean;
  /** A conversa toda, a mais recente no fim. */
  turns: DjTurn[];
  /**
   * As etiquetas da musica a dar. E daqui que saem as cores da vista do DJ:
   * um bloco de hyperpop nao pode ter a mesma luz que um de fado.
   */
  styles: string[];
}

const initial: DjStationState = {
  active: false,
  planning: false,
  error: null,
  remote: false,
  theme: null,
  speaking: false,
  turns: [],
  styles: [],
};

export const djStore = createStore<DjStationState>(() => initial);

export const useDjStation = <T,>(selector: (s: DjStationState) => T): T =>
  useStore(djStore, selector);

/** Ids sinteticos, sempre negativos: nenhuma musica real colide com eles. */
let clipSeq = 0;
let turnSeq = 0;

const djClipSong = (turn: MusicDjNext, uri: string): Song => {
  const now = new Date().toISOString();
  return {
    id: (--clipSeq) as SongId,
    created_at: now,
    updated_at: now,
    title: turn.theme ?? "O Melhor DJ",
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
    dj_clip: { theme: turn.theme, script: turn.text ?? "" },
  };
};

const turnOf = (role: DjTurn["role"], text: string | null, song: Song | null): DjTurn => ({
  key: `${role}-${turnSeq++}`,
  role,
  text,
  song,
});

class Station {
  private unsubscribe: (() => void) | null = null;
  private asking = false;
  private blockedUntil = 0;
  private sessionId: number | null = null;
  private clips: DjVoiceClip[] = [];
  /** Os ids que ESTA sessao meteu na fila. Ver `onPlayerState`. */
  private owned = new Set<number>();
  /** O salto por contar: vai no proximo pedido como sinal negativo. */
  private pendingSkip: SongId | null = null;
  /** Pedido escrito enquanto ele estava a pensar. Ver `steer`. */
  private queued: string | null = null;
  private watching: { id: SongId; position: number; duration: number } | null = null;
  /** O que o leitor tinha antes de a estacao mandar nele. */
  private restoreModes: { loop: LoopMode; shuffle: boolean } | null = null;

  /** Comeca de novo: sessao nova no servidor, fila nova aqui. */
  async start(request?: string): Promise<void> {
    if (getPlaybackView().passive) {
      djStore.setState({ remote: true });
      return;
    }
    this.release();
    this.sessionId = null;
    this.owned = new Set();
    this.pendingSkip = null;
    this.queued = null;
    this.blockedUntil = 0;
    djStore.setState({ ...initial, active: true, turns: request ? [ turnOf("listener", request, null) ] : [] });

    const turn = await this.ask({ request, restart: true });
    if (!turn) return;
    this.seizeModes();
    this.enqueue(turn, { replace: true });
    // A vigilancia so depois de a fila ser dele: antes disto o que esta a
    // tocar e o que o ouvinte escolheu, e a guarda de "ele pegou na fila"
    // fechava a estacao no segundo a seguir a abri-la.
    this.watch();
  }

  /**
   * O ouvinte pede alguma coisa. Ele fala JA: o que estava planeado a
   * seguir cai (foi pensado para outra direccao) e a resposta entra aqui.
   *
   * A caixa NUNCA bloqueia (dono, 2026-08-31): com ele a meio de uma volta,
   * o pedido fica em fila e sai assim que ela acabar. O balao aparece no
   * ecra na hora, que e o que o ouvinte precisa de ver.
   */
  async steer(request: string): Promise<void> {
    if (!djStore.getState().active) return this.start(request);
    djStore.setState({ turns: [ ...djStore.getState().turns, turnOf("listener", request, null) ] });
    if (this.asking) {
      // O ultimo pedido manda: quem escreveu duas vezes seguidas quer a
      // segunda coisa.
      this.queued = request;
      return;
    }
    await this.honour(request);
  }

  private async honour(request: string): Promise<void> {
    this.blockedUntil = 0;
    const turn = await this.ask({ request });
    if (!turn) return;
    this.dropUpcoming();
    this.enqueue(turn, { next: true });
    getTransport().next();
  }

  /** O pedido que ficou em fila enquanto ele pensava. */
  private drain(): void {
    const request = this.queued;
    if (request === null || !djStore.getState().active) return;
    this.queued = null;
    void this.honour(request);
  }

  /**
   * O botao dele: fala JA sobre o que vem a seguir. Nao muda a direccao da
   * sessao - so lhe abre a boca fora da vez.
   */
  async speakNow(): Promise<void> {
    if (!djStore.getState().active) return this.start();
    this.blockedUntil = 0;
    const turn = await this.ask({ speak: true });
    if (!turn) return;
    this.dropUpcoming();
    this.enqueue(turn, { next: true });
    getTransport().next();
  }

  /**
   * Uma estacao nao tem repeticao nem aleatorio: com "repetir tudo" ligado,
   * carregar em seguinte no fim da fila dava a volta e caia na PRIMEIRA
   * fala da noite (dono, 2026-08-31). Sem repeticao, seguinte no fim nao
   * faz nada - e a musica seguinte, que ja vem a caminho, entra sozinha.
   */
  private seizeModes(): void {
    if (this.restoreModes) return;
    const state = playerStore.getState();
    this.restoreModes = { loop: state.loopMode, shuffle: state.shuffle };
    const transport = getTransport();
    transport.setLoopMode("none");
    if (state.shuffle) transport.setShuffle(false);
  }

  private releaseModes(): void {
    if (!this.restoreModes) return;
    const transport = getTransport();
    transport.setLoopMode(this.restoreModes.loop);
    if (this.restoreModes.shuffle) transport.setShuffle(true);
    this.restoreModes = null;
  }

  stop(): void {
    this.releaseModes();
    djStore.setState({ ...initial });
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.watching = null;
    this.sessionId = null;
    this.queued = null;
    // Sair a meio de uma frase e pior do que sair: se ele esta a falar,
    // salta-se o clip antes de o ficheiro desaparecer debaixo do leitor.
    if (isDjClip(playerStore.getState().currentSong)) getTransport().next();
    this.release();
    void oms().music.social.dj.end().catch(() => undefined);
  }

  /** A conversa de uma sessao que ficou a meio, para o ecra a mostrar. */
  async restore(): Promise<void> {
    if (djStore.getState().active) return;
    const session = await oms().music.social.dj.session().catch(() => null);
    if (!session || djStore.getState().active) return;
    djStore.setState({ turns: transcript(session), theme: null });
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
    // estacao sai de cena em vez de continuar a empurrar musicas por cima
    // do que ele escolheu. Uma radio que se recusa a calar e uma avaria.
    if (song && !isDjClip(song) && !this.owned.has(song.id as number)) {
      this.stop();
      return;
    }

    const speaking = isDjClip(song);
    const styles = song && !speaking ? [ ...(song.tags ?? []) ] : djStore.getState().styles;
    const shown = djStore.getState();
    if (speaking !== shown.speaking || styles.join() !== shown.styles.join()) {
      djStore.setState({ speaking, styles });
    }

    this.trackProgress(song, state.position, state.duration);

    // Ha sempre no maximo UMA por tocar, e pede-se assim que a actual
    // comeca: e o que evita o silencio entre musicas sem planear a noite
    // toda a frente.
    if (state.queueIndex >= state.queueOrder.length - 1) void this.advance();
  }

  /**
   * Quem mudou de musica antes de metade saltou-a. Sem isto o DJ nao tem
   * como saber que a direccao esta errada.
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
    if (watching && (watching.id as number) > 0) {
      const heard = watching.duration > 0 ? watching.position / watching.duration : 1;
      if (heard < SKIP_RATIO) this.pendingSkip = watching.id;
    }
    this.watching = { id: song.id, position, duration };
  }

  private async advance(): Promise<void> {
    const skipped = this.pendingSkip;
    const turn = await this.ask({ skippedSongId: skipped ?? undefined });
    if (!turn) return;
    this.pendingSkip = null;
    this.enqueue(turn, {});
  }

  private async ask(input: {
    request?: string;
    skippedSongId?: SongId;
    restart?: boolean;
    speak?: boolean;
  }): Promise<MusicDjNext | null> {
    if (this.asking || Date.now() < this.blockedUntil) return null;
    this.asking = true;
    djStore.setState({ planning: true, error: null });
    try {
      const turn = await oms().music.social.dj.next({
        sessionId: this.sessionId ?? undefined,
        ...input,
      });
      this.sessionId = turn.session_id;
      return turn;
    } catch (error) {
      // O leitor emite a 4 Hz: sem tranca, uma falha vira uma chamada por
      // cada tique. O ecra mostra o erro e o botao volta a estar la.
      this.blockedUntil = Date.now() + RETRY_COOLDOWN_MS;
      djStore.setState({ error: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      this.asking = false;
      djStore.setState({ planning: false });
      // Fora do finally sincrono: o pedido em fila abre outra volta, e essa
      // volta nao pode comecar dentro desta.
      queueMicrotask(() => this.drain());
    }
  }

  private enqueue(turn: MusicDjNext, opts: { replace?: boolean; next?: boolean }): void {
    // A musica vem serializada pelo servidor no mesmo formato de GET /songs;
    // o Song do SDK e o fio, o do dominio marca os ids.
    const song = turn.song as unknown as Song;
    this.owned.add(song.id as number);
    const voice = turn.audio_base64 ? this.voiceSong(turn) : null;
    const transport = getTransport();
    const entries = voice ? [ voice, song ] : [ song ];

    // Estava o ouvinte parado no fim da fila (a musica acabou, ou ele
    // carregou em seguinte enquanto esta ainda vinha a caminho)? Entao o que
    // chega agora comeca sozinho, em vez de ficar a espera de outro toque.
    const before = playerStore.getState();
    const wasWaiting =
      !opts.replace && !opts.next && before.queueIndex >= before.queueOrder.length - 1;

    if (opts.replace) transport.setQueue(entries, 0);
    else if (opts.next) for (const entry of [ ...entries ].reverse()) transport.playNext(entry);
    else for (const entry of entries) transport.addToQueue(entry);

    if (wasWaiting && !before.playing) transport.next();

    djStore.setState({
      theme: turn.theme ?? djStore.getState().theme,
      turns: [ ...djStore.getState().turns, turnOf("dj", turn.text ?? null, song) ],
    });
  }

  private voiceSong(turn: MusicDjNext): Song | null {
    if (!turn.audio_base64) return null;
    const clip = writeDjClip(turn.audio_base64, turn.format ?? "wav");
    this.clips.push(clip);
    return djClipSong(turn, clip.uri);
  }

  /** O que estava planeado a seguir deixa de fazer sentido. */
  private dropUpcoming(): void {
    const transport = getTransport();
    const state = playerStore.getState();
    for (let index = state.queueOrder.length - 1; index > state.queueIndex; index--) {
      transport.removeFromQueue(index);
    }
  }

  private release(): void {
    for (const clip of this.clips) clip.release();
    this.clips = [];
  }
}

/** As voltas do servidor com as musicas ja ligadas a cada uma. */
const transcript = (session: MusicDjSession): DjTurn[] => {
  const songs = new Map((session.songs as unknown as Song[]).map((song) => [ song.id as number, song ]));
  return session.turns.map((turn) =>
    turnOf(turn.role, turn.text, turn.song_id === null ? null : (songs.get(turn.song_id) ?? null)),
  );
};

export const djStation = new Station();
