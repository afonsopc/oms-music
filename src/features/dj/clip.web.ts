/**
 * A metade web de ./clip.ts. Blob e nao data:: a CSP do shell so permite
 * blob: em media-src, e o data: falhava MUDO (o "small jump" que o dono viu
 * na primeira versao do botao).
 */
export interface DjVoiceClip {
  uri: string;
  release(): void;
}

export const writeDjClip = (base64: string, format = "wav"): DjVoiceClip => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: `audio/${format}` }));
  return { uri: url, release: () => URL.revokeObjectURL(url) };
};
