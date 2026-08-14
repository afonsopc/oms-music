//! Barra de menus nativa do macOS (pedido do dono 2026-08-14): o shell deixa
//! de arrancar com o menu default vazio do Tauri e ganha menus UTEIS. A
//! mesma disciplina do tray: transporte emite MediaCommand (o unico ponto de
//! entrada que o bridge ja escuta), e as accoes de UI (cinema, definicoes)
//! emitem um ShellCommand novo que o bridge encaminha para a navegacao.
//!
//! O menu "Editar" e obrigatorio no macOS: sem os predefined undo/copy/paste
//! os atalhos Cmd+C/V/X simplesmente nao funcionam em campo de texto nenhum
//! do webview - nao e cosmetica, e funcionalidade.

use crate::media::MediaCommand;
use crate::miniplayer;
use serde::{Deserialize, Serialize};
use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Manager, Runtime};
use tauri_specta::Event;

/// Accoes de shell que nao sao transporte: o bridge da app escuta este
/// evento e traduz em navegacao/UI (modo cinema, definicoes).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ShellCommand {
    Cinema,
    Settings,
}

pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    // About com a autoria real (pedido do dono): nome, casa e email.
    let about = AboutMetadata {
        name: Some("OMS Music".into()),
        comments: Some("Uma app do O Melhor Site.".into()),
        authors: Some(vec!["Afonso Coutinho <afonso@omelhorsite.pt>".into()]),
        website: Some("https://omelhorsite.pt".into()),
        website_label: Some("omelhorsite.pt".into()),
        copyright: Some("(c) 2026 Afonso Coutinho, O Melhor Site".into()),
        ..Default::default()
    };

    let settings = MenuItemBuilder::with_id("shell_settings", "Definições...")
        .accelerator("Cmd+,")
        .build(app)?;
    // No macOS o PRIMEIRO submenu e sempre o menu da aplicacao.
    let app_menu = SubmenuBuilder::new(app, "OMS Music")
        .item(&PredefinedMenuItem::about(app, Some("Acerca de OMS Music"), Some(about))?)
        .separator()
        .item(&settings)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Ocultar OMS Music"))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("Ocultar as outras"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("Mostrar tudo"))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Sair de OMS Music"))?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Editar")
        .item(&PredefinedMenuItem::undo(app, Some("Desfazer"))?)
        .item(&PredefinedMenuItem::redo(app, Some("Refazer"))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some("Cortar"))?)
        .item(&PredefinedMenuItem::copy(app, Some("Copiar"))?)
        .item(&PredefinedMenuItem::paste(app, Some("Colar"))?)
        .item(&PredefinedMenuItem::select_all(app, Some("Seleccionar tudo"))?)
        .build()?;

    // Transporte pelos MESMOS eventos das teclas de media: um unico caminho
    // ate ao engine, nunca dois atalhos a disputar o mesmo gesto (o menu
    // consome o Cmd+seta antes do webview, e dessa consumacao sai o evento).
    let play_pause = MenuItemBuilder::with_id("shell_toggle", "Tocar / Pausar").build(app)?;
    let next = MenuItemBuilder::with_id("shell_next", "Seguinte")
        .accelerator("Cmd+Right")
        .build(app)?;
    let previous = MenuItemBuilder::with_id("shell_previous", "Anterior")
        .accelerator("Cmd+Left")
        .build(app)?;
    let playback_menu = SubmenuBuilder::new(app, "Reprodução")
        .item(&play_pause)
        .item(&next)
        .item(&previous)
        .build()?;

    let cinema = MenuItemBuilder::with_id("shell_cinema", "Modo cinema")
        .accelerator("Cmd+Shift+F")
        .build(app)?;
    let mini = MenuItemBuilder::with_id("shell_miniplayer", "Mini-player")
        .accelerator("Cmd+Shift+M")
        .build(app)?;
    let view_menu = SubmenuBuilder::new(app, "Vista")
        .item(&cinema)
        .item(&mini)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, Some("Ecrã inteiro"))?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Janela")
        .item(&PredefinedMenuItem::minimize(app, Some("Minimizar"))?)
        .item(&PredefinedMenuItem::maximize(app, Some("Ampliar"))?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, Some("Fechar a janela"))?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &playback_menu, &view_menu, &window_menu])
        .build()?;
    app.set_menu(menu)?;

    app.on_menu_event(|app, event| match event.id().as_ref() {
        "shell_toggle" => {
            let _ = MediaCommand::Toggle.emit(app);
        }
        "shell_next" => {
            let _ = MediaCommand::Next.emit(app);
        }
        "shell_previous" => {
            let _ = MediaCommand::Previous.emit(app);
        }
        "shell_cinema" => {
            let _ = ShellCommand::Cinema.emit(app);
        }
        "shell_settings" => {
            let _ = ShellCommand::Settings.emit(app);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        "shell_miniplayer" => {
            let _ = miniplayer::miniplayer_toggle(app.clone());
        }
        _ => {}
    });

    Ok(())
}
