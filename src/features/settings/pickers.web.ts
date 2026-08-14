/**
 * Web fork of the file-picking seam (Metro picks .web.ts; plano "uma so
 * app", F1). The native module drives expo-file-system's system pickers,
 * which have no browser build - every picker button on web was dead and the
 * availability flags lied about it. The browser primitive for all of them is
 * `<input type="file">`: clicked programmatically inside the user gesture the
 * buttons already provide, `accept`-filtered, `multiple` for batches and
 * `webkitdirectory` for folder walks.
 *
 * The shape trick that makes the uploads work with ZERO api changes: every
 * endpoint appends the picked object straight into FormData
 * (api/endpoints/songs.ts et al). React Native's FormData accepts a plain
 * `{ uri, name, type }`; the browser's does not - it needs a real Blob. So
 * this fork hands back actual browser File instances, widened with the `uri`
 * (an object URL, which also feeds the artwork previews) and `relativePath`
 * expandos the interfaces promise. Callers must therefore pass the picked
 * object THROUGH to the endpoints, never rebuild a `{ uri, name, type }`
 * literal from it - rebuilding would strip the bytes.
 *
 * Picked images go through the same square-crop + JPEG budget ladder as
 * native (the pure maths in @/lib/imageTransform is shared), just executed on
 * a canvas instead of expo-image-manipulator: HEIC camera output and
 * oversized originals get normalized before they reach the backend's image
 * attachers, exactly like on device.
 *
 * Object URLs created here are never revoked: they die with the tab, and the
 * import/settings screens pick a handful of files per session at most.
 */
import { centeredSquareRect, encodePlan, jpegName, scaleToFit } from "@/lib/imageTransform";
import type {
  PickImageOptions,
  PickedAudio,
  PickedFolder,
  PickedImage,
} from "./pickers";

// Mirrors lib/artworkTranscode.ts, which cannot be imported here without
// dragging expo-file-system + expo-image-manipulator into the web bundle.
const ARTWORK_MAX_BYTES = 2 * 1024 * 1024;
const ARTWORK_MAX_EDGE = 1200;
const BANNER_MAX_EDGE = 1600;
const JPEG_MIME = "image/jpeg";

/** Server-accepted upload extensions (POST /songs/import); native parity. */
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".opus"];

/** Folder walks stop here; native parity (pickers.ts MAX_FOLDER_DEPTH). */
const MAX_FOLDER_DEPTH = 4;

export const IMAGE_PICKER_AVAILABLE = true as boolean;
export const AUDIO_PICKER_AVAILABLE = true as boolean;
/**
 * `webkitdirectory` is the only folder-pick primitive the web has (every
 * evergreen engine ships it, prefixed name and all). During static export
 * there is no `document`, so the flag defaults to available there - the
 * SSG markup then matches what the hydrating client renders everywhere the
 * attribute exists, instead of mismatching on every desktop browser.
 */
export const FOLDER_PICKER_AVAILABLE: boolean =
  typeof document === "undefined" || "webkitdirectory" in document.createElement("input");

const hasAudioExtension = (name: string): boolean => {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension));
};

/** Mime first, extension as the fallback (browser mimes are sometimes ""). */
export const isAudioLike = (name: string, mimeType: string): boolean =>
  mimeType.startsWith("audio/") || hasAudioExtension(name);

// ---------------------------------------------------------------------------
// The input element
// ---------------------------------------------------------------------------

interface OpenPickerOptions {
  accept: string;
  multiple?: boolean;
  directory?: boolean;
}

/**
 * One programmatic `<input type="file">` round trip. The element is parked
 * invisibly in the body for the duration - some WebKit builds ignore clicks
 * on detached inputs - and removed once the dialog settles. Browsers that
 * never fire "cancel" (it is Chrome 113+/Safari 16.4+/Firefox 91+) leave the
 * promise pending on dismissal, which is indistinguishable from the user
 * still browsing and holds no UI state: the busy flags only engage after a
 * pick resolves.
 */
const openFilePicker = (options: OpenPickerOptions): Promise<File[]> =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = options.accept;
    input.multiple = options.multiple ?? false;
    if (options.directory) input.webkitdirectory = true;
    input.style.display = "none";

    const settle = (files: File[]): void => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => settle(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => settle([]));

    document.body.appendChild(input);
    input.click();
  });

/** Widens a browser File with the expandos the picked shapes promise. */
const withPickedShape = <T extends File>(
  file: T,
  relativePath: string,
): T & { uri: string; relativePath: string } => {
  const picked = file as T & { uri: string; relativePath: string };
  picked.uri = URL.createObjectURL(file);
  picked.relativePath = relativePath;
  return picked;
};

const toPickedAudio = (file: File, relativePath: string): PickedAudio =>
  withPickedShape(file, relativePath);

// ---------------------------------------------------------------------------
// Images: canvas transcode (native parity for lib/artworkTranscode.ts)
// ---------------------------------------------------------------------------

const canvasToJpegBlob = (canvas: HTMLCanvasElement, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("JPEG encode failed"))),
      JPEG_MIME,
      quality,
    );
  });

/**
 * Same walk as the native compress loop: progressively smaller edges, each
 * tried down the quality ladder, first encode under budget wins. Crop and
 * resize collapse into a single drawImage call per stage.
 */
const transcodeOnCanvas = async (
  source: File,
  options: PickImageOptions,
): Promise<File> => {
  const square = options.square ?? true;
  const maxEdge = options.maxEdge ?? ARTWORK_MAX_EDGE;
  const name = jpegName(source.name);

  const bitmap = await createImageBitmap(source);
  try {
    const rect = square ? centeredSquareRect(bitmap.width, bitmap.height) : null;
    const sourceWidth = rect?.width ?? bitmap.width;
    const sourceHeight = rect?.height ?? bitmap.height;

    let best: Blob | null = null;
    let lastLongestSide: number | null = null;

    for (const stage of encodePlan(maxEdge)) {
      const fitted = scaleToFit(sourceWidth, sourceHeight, stage.edge);
      const width = fitted?.width ?? sourceWidth;
      const height = fitted?.height ?? sourceHeight;
      const longestSide = Math.max(width, height);
      // A pick already smaller than the stage edge would re-encode
      // identically once per stage; skip the stages that cannot shrink it.
      if (lastLongestSide !== null && longestSide === lastLongestSide) continue;
      lastLongestSide = longestSide;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No 2d canvas context");
      context.drawImage(
        bitmap,
        rect?.originX ?? 0,
        rect?.originY ?? 0,
        sourceWidth,
        sourceHeight,
        0,
        0,
        width,
        height,
      );

      for (const quality of stage.qualities) {
        const blob = await canvasToJpegBlob(canvas, quality);
        if (blob.size <= ARTWORK_MAX_BYTES) {
          return new File([blob], name, { type: JPEG_MIME });
        }
        if (!best || blob.size < best.size) best = blob;
      }
    }

    // Nothing fit the budget; hand over the smallest encode produced and let
    // the caller (or the backend's cap) decide, exactly like native.
    if (!best) throw new Error("The image could not be encoded");
    return new File([best], name, { type: JPEG_MIME });
  } finally {
    bitmap.close();
  }
};

export const pickImage = async (
  options: PickImageOptions = {},
): Promise<PickedImage | null> => {
  const [file] = await openFilePicker({ accept: "image/*" });
  if (!file) return null;
  try {
    return withPickedShape(await transcodeOnCanvas(file, options), "");
  } catch {
    // The browser could not decode it (or refused the canvas); send the
    // picked bytes as they are rather than losing the upload entirely.
    return withPickedShape(file, "");
  }
};

/** Artist banners are wide, so they keep their ratio and get a longer edge. */
export const pickBannerImage = (): Promise<PickedImage | null> =>
  pickImage({ square: false, maxEdge: BANNER_MAX_EDGE });

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

/** Mime filter plus extensions: browsers with no mapping for flac/opus would
 *  otherwise gray those files out in the dialog. */
const AUDIO_ACCEPT = ["audio/*", ...AUDIO_EXTENSIONS].join(",");

/** Multi-pick, audio only (non-audio picks are dropped, native parity). */
export const pickAudioFiles = async (): Promise<PickedAudio[]> => {
  const files = await openFilePicker({ accept: AUDIO_ACCEPT, multiple: true });
  return files
    .filter((file) => isAudioLike(file.name, file.type))
    .map((file) => toPickedAudio(file, ""));
};

/** Single audio pick (FR-126 metadata modifier input). */
export const pickAudioFile = async (): Promise<PickedAudio | null> => {
  const [file] = await openFilePicker({ accept: AUDIO_ACCEPT });
  if (!file) return null;
  if (!isAudioLike(file.name, file.type)) return null;
  return toPickedAudio(file, "");
};

/**
 * Folder import (FR-100): the folder name is the resume-tracker key. The
 * browser hands every file back flat, each carrying its
 * `webkitRelativePath` ("Folder/sub/track.mp3"); the top segment is the
 * picked folder, the middle segments reproduce the native walk's prefix and
 * the depth cap skips anything nested deeper than the native walk would go.
 */
export const pickAudioFolder = async (): Promise<PickedFolder | null> => {
  const files = await openFilePicker({ accept: AUDIO_ACCEPT, directory: true });
  if (files.length === 0) return null;

  const firstPath = files[0].webkitRelativePath;
  const path = firstPath ? firstPath.split("/")[0] : "";

  const collected: PickedAudio[] = [];
  for (const file of files) {
    if (!isAudioLike(file.name, file.type)) continue;
    const segments = file.webkitRelativePath.split("/");
    // ["Folder", "sub", "track.mp3"] -> 1 directory level below the pick.
    const directoryDepth = Math.max(0, segments.length - 2);
    if (directoryDepth > MAX_FOLDER_DEPTH) continue;
    collected.push(toPickedAudio(file, segments.slice(1).join("/")));
  }
  return { path, files: collected };
};

// ---------------------------------------------------------------------------
// Bytes in, bytes out
// ---------------------------------------------------------------------------

/** Base64 of a fetched Blob; FileReader is the shared portable read path. */
export const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the response"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });

/** Base64 bytes of a picked file (URL-import artwork uploads). The uris this
 *  receives are the object URLs minted above, which fetch resolves locally. */
export const readBase64 = async (uri: string): Promise<string> => {
  const response = await fetch(uri);
  return blobToBase64(await response.blob());
};

/**
 * FR-126 output on web: there is no app documents directory, the browser's
 * download flow IS "saving to the device". Returns the filename - it is what
 * the success copy can honestly show, since the browser decides the final
 * path (and dedupes it) on its own.
 */
export const saveBase64ToDocuments = async (
  base64: string,
  filename: string,
): Promise<string> => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes]));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Long enough for the download to start; the tab reclaims it regardless.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return filename;
};
