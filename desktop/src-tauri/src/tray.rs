//! Tray nativo do core (plano 3.5, TrayIconBuilder). O menu fala a mesma
//! lingua do resto do shell: cada item de transporte emite um MediaCommand,
//! o MESMO evento que as teclas de media, para o bridge da app ter um unico
//! ponto de entrada. Em Linux isto exige libappindicator3-1 no .deb - fica
//! para a passagem Linux de F5.

use crate::media::MediaCommand;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Runtime};
use tauri_specta::Event;

pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let play_pause = MenuItemBuilder::with_id("play_pause", "Tocar / Pausar").build(app)?;
    let next = MenuItemBuilder::with_id("next", "Seguinte").build(app)?;
    let show = MenuItemBuilder::with_id("show", "Abrir a aplicação").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Sair").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show)
        .separator()
        .item(&play_pause)
        .item(&next)
        .separator()
        .item(&quit)
        .build()?;

    TrayIconBuilder::with_id("oms-music-tray")
        // O icone da app (gerado por `tauri icon`); sem unwrap para nao
        // rebentar num build sem icones - o tray fica sem imagem, a app vive.
        .icon(
            app.default_window_icon()
                .cloned()
                .unwrap_or_else(|| tauri::image::Image::new_owned(vec![0, 0, 0, 0], 1, 1)),
        )
        .tooltip("OMS Music")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "play_pause" => {
                let _ = MediaCommand::Toggle.emit(app);
            }
            "next" => {
                let _ = MediaCommand::Next.emit(app);
            }
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}
