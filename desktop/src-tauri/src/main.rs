// Entry point fino, layout canonico do Tauri v2: tudo vive na lib para o
// teste export_bindings poder construir o mesmo builder sem abrir janelas.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Em Linux, as variaveis de graficos tem de estar exportadas ANTES de o
    // primeiro webview nascer (plano 3.6): o WebKitGTK le-as ao inicializar
    // o renderer, e depois disso ja nao ha volta. E por isso que isto vive
    // aqui no main() e nao num setup() do builder, e por isso que e o Rust a
    // po-las - nunca se pede ao utilizador que edite o .desktop a mao.
    #[cfg(target_os = "linux")]
    linux_graphics_env();

    oms_music_desktop_lib::run()
}

/// Escada de mitigacao dos bugs DMABUF/explicit-sync do WebKitGTK, que sao
/// endemicos com o driver proprietario NVIDIA (janela branca, flicker,
/// GPU hangs). Regras:
///
/// 1. Nunca pisar uma escolha explicita do utilizador: cada variavel so e
///    definida se ainda nao existir no ambiente.
/// 2. Degrau NVIDIA (automatico): com o modulo nvidia carregado, desligar o
///    explicit sync e o renderer DMABUF. E o par que a comunidade Tauri
///    converge ha anos para estes drivers, e e inocuo em Mesa.
/// 3. Degrau manual (OMS_WEBKIT_SAFE=1): desliga tambem o compositing
///    acelerado, para VMs sem aceleracao e drivers fora da matriz. Fica como
///    valvula de escape documentada, nunca como default - custa CPU a todos
///    os outros.
#[cfg(target_os = "linux")]
fn linux_graphics_env() {
    use std::path::Path;

    fn set_default(key: &str, value: &str) {
        if std::env::var_os(key).is_none() {
            std::env::set_var(key, value);
        }
    }

    let nvidia =
        Path::new("/proc/driver/nvidia").exists() || Path::new("/sys/module/nvidia").exists();

    if nvidia {
        set_default("__NV_DISABLE_EXPLICIT_SYNC", "1");
        set_default("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    if std::env::var_os("OMS_WEBKIT_SAFE").is_some() {
        set_default("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        set_default("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
}
