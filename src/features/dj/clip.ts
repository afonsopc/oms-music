/**
 * O WAV falado que chega em base64 tem de virar um URI que o motor saiba
 * tocar. Nativo: um ficheiro na cache (expo-file-system, API de SDK 54+ -
 * File + Paths, sincrona). Web: ./clip.web.ts, com um blob (a CSP do shell
 * so permite blob: em media-src; data: falhava MUDO).
 *
 * Quem escreve tem de libertar: `release()` apaga o ficheiro. A estacao
 * chama-o quando o clip sai da fila.
 */
import { File, Paths } from "expo-file-system";

export interface DjVoiceClip {
  /** file:// que o `audio_url` da musica sintetica leva verbatim. */
  uri: string;
  release(): void;
}

let counter = 0;

export const writeDjClip = (base64: string, format = "wav"): DjVoiceClip => {
  const file = new File(Paths.cache, `dj-clip-${Date.now()}-${counter++}.${format}`);
  file.create({ overwrite: true });
  file.write(base64, { encoding: "base64" });
  return {
    uri: file.uri,
    release: () => {
      try {
        file.delete();
      } catch {
        // Um clip que ja nao existe (cache limpa pelo sistema) nao e erro:
        // o objectivo era nao ficar la, e nao ficou.
      }
    },
  };
};
