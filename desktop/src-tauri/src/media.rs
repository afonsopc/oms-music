//! Teclas de media, Now Playing (macOS), MPRIS (Linux) e SMTC (Windows) via
//! souvlaki (plano 3.4). O fluxo e simetrico ao lockScreen.ts nativo:
//!
//!  - JS -> Rust: o bridge da app (src/desktop/ em oms-music) observa o
//!    playerStore e chama `update_now_playing` / `update_playback`; o Rust e
//!    um espelho burro, nunca a fonte de verdade.
//!  - Rust -> JS: cada botao fisico/da plataforma vira um evento
//!    `MediaCommand` cujo shape e EXACTAMENTE o RemoteCommand de
//!    src/player/lockScreen.ts, para o bridge o poder despachar por
//!    routeRemoteCommand sem traducao.

use serde::{Deserialize, Serialize};
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition,
    PlatformConfig, SeekDirection,
};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};
use tauri_specta::Event;

/// Espelho 1:1 do RemoteCommand de src/player/lockScreen.ts. O serde emite
/// `{"kind":"play"}`, `{"kind":"seek","seconds":42}` etc.; qualquer renomeacao
/// aqui aparece no bindings.ts gerado e parte o typecheck do bridge em vez de
/// falhar em silencio.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MediaCommand {
    Play,
    Pause,
    Toggle,
    Next,
    Previous,
    SeekForward,
    SeekBackward,
    Seek { seconds: f64 },
}

/// Metadata que o bridge envia por cada mudanca de musica. Shape decalcado do
/// LockScreenMetadata da app (title/artist/albumTitle/artworkUrl) mais a
/// duracao, que o Now Playing quer para desenhar a barra de progresso.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub album_title: String,
    pub artwork_url: Option<String>,
    pub duration_s: Option<f64>,
}

/// souvlaki nao e Send no macOS (guarda ponteiros ObjC), mas os alvos reais -
/// MPNowPlayingInfoCenter e MPRemoteCommandCenter - sao singletons de processo
/// que aceitam mensagens de qualquer thread. Todo o acesso passa pelo Mutex,
/// portanto nunca ha duas mensagens em voo a partir daqui.
pub struct MediaState {
    controls: Mutex<Option<MediaControls>>,
}

unsafe impl Send for MediaState {}
unsafe impl Sync for MediaState {}

/// Cria os controlos e liga o handler de eventos. Chamado no setup do Tauri,
/// que corre na main thread - obrigatorio no macOS, onde o attach regista
/// callbacks no MPRemoteCommandCenter.
pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let config = PlatformConfig {
        // Nome D-Bus do MPRIS em Linux; ignorado no macOS.
        dbus_name: "pt.omelhorsite.music",
        display_name: "OMS Music",
        // hwnd so interessa no Windows (SMTC), que e F6.
        hwnd: None,
    };
    let mut controls = MediaControls::new(config)?;

    let handle = app.clone();
    controls.attach(move |event: MediaControlEvent| {
        if let Some(command) = map_event(&handle, event) {
            // Perder um emit (janela a fechar, etc.) nao e um erro do player.
            let _ = command.emit(&handle);
        }
    })?;

    app.manage(MediaState {
        controls: Mutex::new(Some(controls)),
    });
    Ok(())
}

/// Traduz o evento da plataforma no MediaCommand que o bridge entende.
/// Raise e Quit resolvem-se aqui no shell: mostrar a janela e sair nao sao
/// assuntos do player.
fn map_event<R: Runtime>(app: &AppHandle<R>, event: MediaControlEvent) -> Option<MediaCommand> {
    match event {
        MediaControlEvent::Play => Some(MediaCommand::Play),
        MediaControlEvent::Pause => Some(MediaCommand::Pause),
        MediaControlEvent::Toggle => Some(MediaCommand::Toggle),
        MediaControlEvent::Next => Some(MediaCommand::Next),
        MediaControlEvent::Previous => Some(MediaCommand::Previous),
        // Stop nao existe no transport da app; pausa e o equivalente honesto.
        MediaControlEvent::Stop => Some(MediaCommand::Pause),
        MediaControlEvent::Seek(SeekDirection::Forward) => Some(MediaCommand::SeekForward),
        MediaControlEvent::Seek(SeekDirection::Backward) => Some(MediaCommand::SeekBackward),
        // O salto de 10s e decisao da app (SEEK_JUMP_S no lockScreen.ts); um
        // SeekBy da plataforma degrada para a mesma semantica.
        MediaControlEvent::SeekBy(SeekDirection::Forward, _) => Some(MediaCommand::SeekForward),
        MediaControlEvent::SeekBy(SeekDirection::Backward, _) => Some(MediaCommand::SeekBackward),
        MediaControlEvent::SetPosition(MediaPosition(position)) => Some(MediaCommand::Seek {
            seconds: position.as_secs_f64(),
        }),
        MediaControlEvent::Raise => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            None
        }
        MediaControlEvent::Quit => {
            app.exit(0);
            None
        }
        MediaControlEvent::OpenUri(_) => None,
        // Volume por MPRIS (Linux) fica para a passagem Linux de F5: o
        // RemoteCommand da app nao tem setVolume e o macOS nunca emite isto.
        MediaControlEvent::SetVolume(_) => None,
    }
}

/// O bridge chama isto por cada mudanca de musica (e limpa com None no fim da
/// fila / logout). Metadata fresca por musica, como o lockScreen.ts exige.
#[tauri::command]
#[specta::specta]
pub fn update_now_playing(
    state: tauri::State<'_, MediaState>,
    now_playing: Option<NowPlaying>,
) -> Result<(), String> {
    let mut guard = state.controls.lock().map_err(|e| e.to_string())?;
    let Some(controls) = guard.as_mut() else {
        return Ok(());
    };
    match now_playing {
        Some(meta) => controls
            .set_metadata(MediaMetadata {
                title: Some(&meta.title),
                artist: Some(&meta.artist),
                album: Some(&meta.album_title),
                cover_url: meta.artwork_url.as_deref(),
                duration: meta.duration_s.filter(|d| *d > 0.0).map(Duration::from_secs_f64),
            })
            .map_err(|e| format!("{e:?}")),
        None => controls
            .set_playback(MediaPlayback::Stopped)
            .map_err(|e| format!("{e:?}")),
    }
}

/// Estado tocar/pausa + posicao. O bridge manda em flips de estado, saltos de
/// seek e num tick lento (5s) enquanto toca - a posicao autoritativa continua
/// do lado do player, isto e so o espelho para a UI da plataforma.
#[tauri::command]
#[specta::specta]
pub fn update_playback(
    state: tauri::State<'_, MediaState>,
    playing: bool,
    position_s: f64,
) -> Result<(), String> {
    let mut guard = state.controls.lock().map_err(|e| e.to_string())?;
    let Some(controls) = guard.as_mut() else {
        return Ok(());
    };
    let progress = Some(MediaPosition(Duration::from_secs_f64(position_s.max(0.0))));
    let playback = if playing {
        MediaPlayback::Playing { progress }
    } else {
        MediaPlayback::Paused { progress }
    };
    controls.set_playback(playback).map_err(|e| format!("{e:?}"))
}
