//! Shell Tauri de oms-music (plano "uma so app", F5, macOS primeiro).
//!
//! O que este shell E: a moldura nativa do export web - janela, tray,
//! mini-player NSPanel, teclas de media/Now Playing/MPRIS, single-instance,
//! window-state e updater assinado. O que este shell NAO e: um player. O
//! audio fica no webview nesta fase (spike 4: um <audio> activo marca o
//! processo WebKit como audivel, o App Nap nao entra e nada e estrangulado);
//! o motor Rust so chega em F6.
//!
//! A ponte com o JS e gerada pelo tauri-specta (scripts/export-bindings.sh
//! -> desktop/bindings.ts). O lado da app vive em src/desktop/ no repo
//! principal e usa os globals `window.__TAURI__` (withGlobalTauri), para o
//! package.json da app nao ganhar dependencias novas.

mod media;
mod miniplayer;
mod tray;

use tauri::Manager;
use tauri_specta::{collect_commands, collect_events};

/// Builder do specta partilhado entre o run() e o teste export_bindings:
/// a lista de comandos/eventos existe UMA vez, por isso o bindings.ts nunca
/// fica para tras em silencio.
fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            media::update_now_playing,
            media::update_playback,
            miniplayer::miniplayer_toggle::<tauri::Wry>,
            miniplayer::miniplayer_set_size::<tauri::Wry>,
            miniplayer::miniplayer_get_size::<tauri::Wry>,
        ])
        .events(collect_events![media::MediaCommand])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta = specta_builder();

    tauri::Builder::default()
        // Primeiro plugin de proposito: um segundo lancamento nao pode chegar
        // a criar webview nenhum (dois processos disputariam o dispositivo de
        // audio, plano 3.5); foca a janela existente e morre.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        // Posicao/tamanho da janela principal entre sessoes (plano 4.5). O
        // mini-player esta fora: os presets dele persistem em miniplayer.rs.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&[miniplayer::MINIPLAYER_LABEL])
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(specta.invoke_handler())
        .setup(move |app| {
            specta.mount_events(app);
            media::init(app.handle())?;
            tray::init(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao arrancar o shell desktop");
}

#[cfg(test)]
mod tests {
    /// Regenera desktop/bindings.ts. Corre via scripts/export-bindings.sh
    /// (cargo test export_bindings) - um teste em vez de um passo do build
    /// para nao abrir janela nenhuma e para o diff do bindings.ts aparecer
    /// no git como qualquer outra alteracao revista.
    #[test]
    fn export_bindings() {
        super::specta_builder()
            .export(
                specta_typescript::Typescript::default().header(
                    "// GERADO por tauri-specta (desktop/scripts/export-bindings.sh). NAO editar a mao.\n\
                     // O bridge da app (src/desktop/ em oms-music) mantem um espelho minimo destes\n\
                     // tipos sobre window.__TAURI__; se este ficheiro mudar, o espelho muda tambem.\n",
                ),
                "../bindings.ts",
            )
            .expect("falha a exportar bindings.ts");
    }
}
