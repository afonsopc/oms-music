//! Actualizacoes automaticas (plano 3.6). Procura no arranque e de 4 em 4
//! horas no endpoint do tauri.conf.json (updates.omelhorsite.pt, que da 302
//! para o latest.json do ultimo release no GitHub). Havendo versao nova,
//! descarrega e instala em segundo plano - a assinatura e verificada pelo
//! plugin contra a pubkey do tauri.conf.json - e so DEPOIS pergunta uma vez
//! "Reiniciar agora?". Com "Depois" a versao nova ja esta no disco e entra no
//! proximo arranque; essa versao nao volta a ser perguntada nesta sessao.
//!
//! Falhas (sem rede, .app em pasta so de leitura, deb/Flatpak) ficam no log
//! e mais nada: nenhum erro chega ao utilizador.

use std::time::Duration;

use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;

/// Espera antes da primeira procura, para nao competir com o arranque.
const FIRST_CHECK: Duration = Duration::from_secs(20);
const EVERY: Duration = Duration::from_secs(4 * 60 * 60);

pub fn init<R: Runtime>(app: &AppHandle<R>) {
    if !supported() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        // Versao ja instalada e a espera de reinicio: nao se descarrega nem
        // se pergunta outra vez.
        let mut installed: Option<String> = None;
        loop {
            match check_and_install(&app, installed.as_deref()).await {
                Ok(Some(version)) => {
                    installed = Some(version);
                    ask_restart(&app);
                }
                Ok(None) => {}
                Err(error) => eprintln!("[updates] {error}"),
            }
            tokio::time::sleep(EVERY).await;
        }
    });
}

/// Em Linux o updater so sabe trocar um AppImage; um .deb ou um Flatpak
/// descarregavam 100 MB para nada.
fn supported() -> bool {
    if cfg!(target_os = "linux") {
        return std::env::var_os("APPIMAGE").is_some();
    }
    true
}

async fn check_and_install<R: Runtime>(
    app: &AppHandle<R>,
    installed: Option<&str>,
) -> Result<Option<String>, tauri_plugin_updater::Error> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(None);
    };
    if installed == Some(update.version.as_str()) {
        return Ok(None);
    }
    let bytes = update.download(|_, _| {}, || {}).await?;
    update.install(bytes)?;
    Ok(Some(update.version))
}

fn ask_restart<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    app.dialog()
        .message("Há uma versão nova. Reiniciar agora?")
        .title("OMS Music")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Reiniciar".into(),
            "Depois".into(),
        ))
        .show(move |restart| {
            if restart {
                handle.restart();
            }
        });
}
