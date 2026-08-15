//! Mini-player como janela propria (plano 3.5): NSPanel no macOS via
//! tauri-nspanel (flutua sobre outras apps, nao rouba foco, aparece em todos
//! os Spaces), janela normal always-on-top nas outras plataformas. Tres
//! tamanhos como o Spotify - barra so-transporte, rectangulo, quadrado com
//! artwork grande - e, ao contrario do Spotify (queixa aberta deles), o
//! tamanho escolhido PERSISTE entre sessoes, num JSON no app_config_dir.
//!
//! A janela carrega o mesmo bundle com `?miniplayer=1`: o shell so garante a
//! moldura; o layout proprio do mini-player e trabalho da app (F3/F5 da UI),
//! que pode ler o query param quando o tiver.

use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

pub const MINIPLAYER_LABEL: &str = "miniplayer";
const PREFS_FILE: &str = "miniplayer.json";

/// Os tres presets. Sem tamanho livre de proposito: um mini-player
/// redimensionavel a pixel acaba sempre numa forma que nenhum layout serve.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type, Default)]
#[serde(rename_all = "camelCase")]
pub enum MiniplayerSize {
    /// Barra fina so com transporte.
    Bar,
    /// Rectangulo com artwork pequena + transporte.
    #[default]
    Rect,
    /// Quadrado com artwork grande.
    Square,
}

impl MiniplayerSize {
    /// Pontos logicos (o Tauri converte para pixels fisicos por DPI).
    fn dimensions(self) -> (f64, f64) {
        match self {
            MiniplayerSize::Bar => (420.0, 84.0),
            MiniplayerSize::Rect => (420.0, 240.0),
            MiniplayerSize::Square => (360.0, 440.0),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct MiniplayerPrefs {
    size: MiniplayerSize,
}

fn prefs_path<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(PREFS_FILE))
}

fn load_prefs<R: Runtime>(app: &AppHandle<R>) -> MiniplayerPrefs {
    prefs_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_prefs<R: Runtime>(app: &AppHandle<R>, prefs: &MiniplayerPrefs) {
    let Some(path) = prefs_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(raw) = serde_json::to_string_pretty(prefs) {
        // Perder a preferencia e chato, nao e fatal; sem unwrap.
        let _ = fs::write(path, raw);
    }
}

/// Cria (ou devolve) a janela do mini-player ja com o tamanho persistido.
fn ensure_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::WebviewWindow<R>> {
    if let Some(existing) = app.get_webview_window(MINIPLAYER_LABEL) {
        return Ok(existing);
    }
    let (width, height) = load_prefs(app).size.dimensions();
    let window = WebviewWindowBuilder::new(
        app,
        MINIPLAYER_LABEL,
        WebviewUrl::App("index.html?miniplayer=1".into()),
    )
    .title("OMS Music")
    .inner_size(width, height)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    // Fallback honesto fora do macOS; no macOS o to_panel abaixo substitui
    // isto por um NSPanel a serio.
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .build()?;

    #[cfg(target_os = "macos")]
    promote_to_panel(&window);

    Ok(window)
}

/// macOS: converte a NSWindow num NSPanel nao-activante (nao rouba o foco a
/// app onde o utilizador esta a escrever), flutuante e presente em todos os
/// Spaces - exactamente o que um mini-player deve ser (plano 3.5: NSPanel,
/// nao NSWindow).
#[cfg(target_os = "macos")]
fn promote_to_panel<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    use tauri_nspanel::WebviewWindowExt;

    // Corpo INTEIRO dentro de um catch de NSException: no macOS 26 a
    // promocao atira excepcoes Objective-C (reclass/setStyleMask), e uma
    // NSException a atravessar frames Rust nao e apanhavel - o runtime
    // aborta o processo inteiro ("Rust cannot catch foreign exceptions",
    // report do dono 2026-08-15, destapado assim que o init do plugin deixou
    // o to_panel correr). Com o catch, o pior caso volta a ser o fallback
    // documentado: janela normal always-on-top.
    let outcome = unsafe {
        objc_exception::r#try(|| match window.to_panel() {
            Ok(panel) => {
                // NSFloatingWindowLevel = 3: acima das janelas normais, abaixo
                // de menus/dock, que e onde um mini-player pertence.
                panel.set_level(3);
                // 1 << 7: NSWindowStyleMaskNonActivatingPanel.
                panel.set_style_mask(1 << 7);
                // canJoinAllSpaces (1<<0) | fullScreenAuxiliary (1<<8):
                // visivel em todos os Spaces e sobre apps em ecra inteiro.
                panel.set_collection_behaviour(
                    tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior::from_bits_retain(
                        (1 << 0) | (1 << 8),
                    ),
                );
            }
            Err(error) => {
                // Sem panico: a janela continua a existir como always-on-top
                // normal, que e o mesmo fallback das outras plataformas.
                eprintln!("miniplayer: to_panel falhou, fica janela normal: {error:?}");
            }
        })
    };
    if outcome.is_err() {
        eprintln!("miniplayer: NSException na promocao a NSPanel; fica janela normal");
    }
}

/// Mostra/esconde; devolve o estado final (true = visivel) para a UI poder
/// reflectir sem segunda chamada.
#[tauri::command]
#[specta::specta]
pub fn miniplayer_toggle<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let window = ensure_window(&app).map_err(|e| e.to_string())?;
    let visible = window.is_visible().map_err(|e| e.to_string())?;
    if visible {
        window.hide().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        window.show().map_err(|e| e.to_string())?;
        Ok(true)
    }
}

/// Muda o preset, aplica ja se a janela existir, e persiste SEMPRE - e esta
/// persistencia que e a nossa melhoria sobre o Spotify.
#[tauri::command]
#[specta::specta]
pub fn miniplayer_set_size<R: Runtime>(
    app: AppHandle<R>,
    size: MiniplayerSize,
) -> Result<(), String> {
    save_prefs(&app, &MiniplayerPrefs { size });
    if let Some(window) = app.get_webview_window(MINIPLAYER_LABEL) {
        let (width, height) = size.dimensions();
        window
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Preset persistido, para a UI arrancar com o selector certo.
#[tauri::command]
#[specta::specta]
pub fn miniplayer_get_size<R: Runtime>(app: AppHandle<R>) -> MiniplayerSize {
    load_prefs(&app).size
}
