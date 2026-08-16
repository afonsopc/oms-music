/**
 * Exportar um media (música/original/stems) para fora da app (pedido do
 * dono, 2026-08-16: "download das musicas e stems e musica original a partir
 * das settings na tab de songs"). Isto é EXPORTAÇÃO para o utilizador, não o
 * offline: o offline (downloads/) guarda bytes para a app tocar; isto
 * entrega um ficheiro ao dono do telemóvel/computador.
 *
 * Três plataformas, três saídas:
 *  - shell desktop: comando Rust `cache_export` (o webview está de propósito
 *    sem plugins fs/http - capabilities/main.json) que grava na pasta
 *    Downloads do sistema;
 *  - browser: fetch -> blob -> <a download> (o atributo download é ignorado
 *    em URLs cross-origin, por isso o blob é obrigatório e não um luxo);
 *  - nativo: expo-file-system para o cache + share sheet (expo-sharing), que
 *    é o "Guardar em Ficheiros"/"Save to Downloads" do sistema.
 */
import { Platform } from "react-native";
import { downloadUrl } from "@/api/mediaUrl";
import { getTauriGlobals } from "@/desktop/tauri";
import type { MediaId } from "@/domain/ids";

/** Nome seguro em qualquer sistema de ficheiros; a extensão vem do servidor. */
const sanitize = (name: string): string => {
  const safe = name.replace(/[/\\:*?"<>|]/g, "_").trim().replace(/\.+$/, "");
  return safe.length > 0 ? safe : "musica";
};

const extensionFor = (contentType: string | null): string => {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("flac")) return "flac";
  if (ct.includes("wav")) return "wav";
  if (ct.includes("ogg")) return "ogg";
  if (ct.includes("mp4") || ct.includes("m4a")) return "m4a";
  return "mp3";
};

const exportOnWeb = async (nodeId: MediaId, baseName: string): Promise<void> => {
  const response = await fetch(downloadUrl(nodeId), { credentials: "include" });
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${baseName}.${extensionFor(response.headers.get("content-type"))}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // O revoke imediato corta o download no Safari; um minuto chega e sobra.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
};

const exportOnNative = async (nodeId: MediaId, baseName: string): Promise<void> => {
  const { File, Paths } = await import("expo-file-system");
  const Sharing = await import("expo-sharing");
  const destination = new File(
    Paths.cache,
    // id no nome para dois exports simultâneos não se pisarem
    `export-${nodeId}-${sanitize(baseName)}.mp3`,
  );
  if (destination.exists) destination.delete();
  const file = await File.downloadFileAsync(downloadUrl(nodeId), destination);
  try {
    await Sharing.shareAsync(file.uri, { dialogTitle: sanitize(baseName) });
  } finally {
    // O share sheet copia; o ficheiro no cache é lixo a partir daqui.
    if (file.exists) file.delete();
  }
};

/** Resolve quando o ficheiro saiu da app; lança em falha de rede/escrita. */
export const exportMedia = async (nodeId: MediaId, baseName: string): Promise<void> => {
  const name = sanitize(baseName);
  const tauri = getTauriGlobals();
  if (tauri) {
    await tauri.core.invoke("cache_export", { mediaId: nodeId, filename: name });
    return;
  }
  if (Platform.OS === "web") return exportOnWeb(nodeId, name);
  return exportOnNative(nodeId, name);
};
