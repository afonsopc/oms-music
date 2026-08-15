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

mod cache;
mod media;
mod menubar;
mod miniplayer;
mod tray;

use tauri::{Manager, WebviewWindowBuilder};
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
            // Camada local-first (cache/). Nenhum destes comandos aparece em
            // capabilities/, e isso nao e uma escolha: comandos DA APP nao
            // passam pela ACL de todo enquanto o crate nao trouxer um
            // manifesto de permissoes proprio, portanto um ficheiro de
            // capability nao os limitaria mesmo que os listasse. O limite
            // esta no codigo: cada comando exige `webview.label() == "main"`
            // (commands::guard), para o webview do mini-player nao poder
            // reapontar a cache ou destrui-la.
            cache::commands::cache_open::<tauri::Wry>,
            cache::commands::cache_close::<tauri::Wry>,
            cache::commands::cache_set_auth::<tauri::Wry>,
            cache::commands::cache_subscribe::<tauri::Wry>,
            cache::commands::cache_download::<tauri::Wry>,
            cache::commands::cache_predict::<tauri::Wry>,
            cache::commands::cache_cancel::<tauri::Wry>,
            cache::commands::cache_promote::<tauri::Wry>,
            cache::commands::cache_remove_song::<tauri::Wry>,
            cache::commands::cache_list_songs::<tauri::Wry>,
            cache::commands::cache_list_files::<tauri::Wry>,
            cache::commands::cache_usage::<tauri::Wry>,
            cache::commands::cache_collections_list::<tauri::Wry>,
            cache::commands::cache_collections_add::<tauri::Wry>,
            cache::commands::cache_collections_remove::<tauri::Wry>,
            cache::commands::cache_collections_set_songs::<tauri::Wry>,
            cache::commands::cache_collections_songs::<tauri::Wry>,
            cache::commands::cache_playlists_list::<tauri::Wry>,
            cache::commands::cache_playlists_upsert::<tauri::Wry>,
            cache::commands::cache_playlists_remove::<tauri::Wry>,
            cache::commands::cache_lyrics_get::<tauri::Wry>,
            cache::commands::cache_lyrics_set::<tauri::Wry>,
            cache::commands::cache_set_budget::<tauri::Wry>,
            cache::commands::cache_purge::<tauri::Wry>,
        ])
        .events(collect_events![media::MediaCommand, menubar::ShellCommand])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta = specta_builder();

    let builder = tauri::Builder::default()
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
        // A camada local-first. O estado e criado vazio: so o cache_open (com
        // um utilizador) e que abre o indice e os directorios.
        .manage(cache::CacheState::default())
        // O protocolo de media, na variante ASSINCRONA. A sincrona corre na
        // thread da UI e faria a janela engasgar-se a cada seek, que e
        // exactamente o gesto que isto existe para tornar instantaneo.
        .register_asynchronous_uri_scheme_protocol(cache::SCHEME, cache::protocol::handle);

    // O manager de paineis do tauri-nspanel. Sem este init o to_panel() do
    // miniplayer chama state() antes de manage() e o processo INTEIRO morre
    // em panico ao clicar no toggle (report do dono 2026-08-15) - o fallback
    // "fica janela normal" do promote_to_panel nunca chegava a correr.
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .invoke_handler(specta.invoke_handler())
        .setup(move |app| {
            specta.mount_events(app);
            // A janela e criada AQUI e nao pelo runtime (daí o `"create":
            // false` no tauri.conf.json), e e a primeira coisa do setup para
            // a ordem de arranque ficar igual a de antes: quem vem a seguir
            // (tray, menubar) ja conta com uma janela "main" existente.
            build_main_window(app.handle())?;
            media::init(app.handle())?;
            menubar::init(app.handle())?;
            tray::init(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao arrancar o shell desktop");
}

/// Cria a janela principal a partir da MESMA entrada de `tauri.conf.json` (que
/// tem `"create": false` so por causa disto) para lhe poder pendurar um script
/// de inicializacao.
///
/// Isto e carga util, nao conveniencia: `src/downloads/register.ts` corre no
/// momento do IMPORT e nao pode esperar por um `invoke`. Um global injectado
/// antes de o bundle sequer ser lido e a unica resposta SINCRONA possivel a
/// pergunta "esta shell tem downloads?". Em Linux a resposta e `false` (bug
/// 146351 do WebKit) e o fork desktop simplesmente nao se instala.
fn build_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let Some(config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
    else {
        return Ok(());
    };
    let script = format!(
        "window.__OMS_DESKTOP__={{cacheAvailable:{},cacheOrigin:{}}};",
        cache::serve::available(),
        serde_json::to_string(&cache::serve::origin()).unwrap_or_else(|_| "\"\"".into()),
    );
    WebviewWindowBuilder::from_config(app, &config)?
        .initialization_script(&script)
        .build()?;
    Ok(())
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
                specta_typescript::Typescript::default()
                    // Contagens de bytes e timestamps sao i64 em Rust. O serde
                    // serializa-os como NUMERO JSON, portanto do lado do
                    // JSON.parse eles ja sao `number` - emitir `bigint` seria
                    // descrever um wire format que nao existe. Os valores em
                    // causa (bytes de cache, milissegundos) ficam
                    // confortavelmente dentro dos 2^53 exactos do double.
                    .bigint(specta_typescript::BigIntExportBehavior::Number)
                    .header(
                    "// GERADO por tauri-specta (desktop/scripts/export-bindings.sh). NAO editar a mao.\n\
                     // O bridge da app (src/desktop/ em oms-music) mantem um espelho minimo destes\n\
                     // tipos sobre window.__TAURI__; se este ficheiro mudar, o espelho muda tambem.\n",
                ),
                "../bindings.ts",
            )
            .expect("falha a exportar bindings.ts");
    }
}
