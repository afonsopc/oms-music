/**
 * Playlist artwork picking (FR-51).
 *
 * O pick vem do MESMO seam dos ecrãs de settings (`features/settings/pickers`),
 * que já tem fork nativo (os pickers do expo-file-system) e fork web (um
 * `<input type="file">` com o recorte e a escada de qualidade feitos em
 * canvas). Este ficheiro chamava o `File.pickFileAsync` directamente, e na web
 * isso é um stub que avisa na consola e devolve `undefined`: carregar em
 * "Alterar Artwork" no browser não abria dialogo nenhum. O seam tinha sido
 * escrito exactamente para tapar este buraco nos botões dos settings; faltava
 * esta porta passar por lá.
 *
 * O objecto escolhido segue INTEIRO para o upload (`toFileInput` em
 * api/oms.ts decide bytes na web e descritor no nativo). Refazê-lo aqui como
 * um literal `{ uri, name, type }` deitava fora os bytes do File do browser.
 */
import { pickImage, type PickedImage } from "@/features/settings/pickers";
import { ARTWORK_MAX_BYTES, ARTWORK_MAX_MB } from "@/lib/artworkTranscode";

/** Re-exported under the names the screen already imports. */
export const MAX_ARTWORK_BYTES = ARTWORK_MAX_BYTES;
export const MAX_ARTWORK_MB = ARTWORK_MAX_MB;

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".gif"];

/** O que o picker devolve, tal e qual: na web é um `File` do browser. */
export type PickedArtwork = PickedImage;

export type ArtworkPickOutcome =
  | { kind: "canceled" }
  | { kind: "notAnImage" }
  | { kind: "tooLarge"; size: number }
  | { kind: "picked"; artwork: PickedArtwork };

/** Mime first, extension as the fallback (content:// mimes are often ""). */
export const isImageLike = (name: string, mimeType: string): boolean => {
  if (mimeType.startsWith("image/")) return true;
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
};

export const pickPlaylistArtwork = async (): Promise<ArtworkPickOutcome> => {
  const picked = await pickImage({ square: true });
  if (!picked) return { kind: "canceled" };
  if (!isImageLike(picked.name, picked.type)) return { kind: "notAnImage" };
  // O tecto só morde no caminho de recurso: quando o descodificador não
  // consegue ler o ficheiro, o pick volta com os bytes originais e não houve
  // escada de qualidade nenhuma a cortá-los. Um pick transcodificado já vem
  // dentro do orçamento por construção.
  if (picked.size != null && picked.size > MAX_ARTWORK_BYTES) {
    return { kind: "tooLarge", size: picked.size };
  }
  return { kind: "picked", artwork: picked };
};
