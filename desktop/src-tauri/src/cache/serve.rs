//! Como e que os bytes locais chegam ao `<audio>` - e porque e que em Linux,
//! na v1, nao chegam de todo.
//!
//! O bug 146351 do WebKit esta aberto desde 2015: o WebKitGTK NAO consegue
//! reproduzir media a partir de um esquema de URI proprio, porque o GStreamer
//! nao tem um handler de URI para protocolos nao-standard. Imagens funcionam,
//! media nao. Isto nao e uma limitacao que se descubra em runtime com um
//! elemento que fica mudo: e conhecida, e por isso esta desenhada de raiz.
//!
//! Em Linux, `available()` devolve `false`, o `cache_open` di-lo ao JS, o fork
//! desktop nao se instala e a app comporta-se exactamente como a web - faz
//! streaming de tudo. O trabalho seguinte (bilhete a parte, nao um buraco para
//! ser descoberto a correr) e um servidor `axum` + `tower_http::ServeFile` em
//! `127.0.0.1:0` com um token de sessao como segmento do caminho, e a porta
//! nunca escrita em disco.
//!
//! A origem tambem NAO se constroi em JS: difere por plataforma
//! (`omscache://localhost/...` em macOS/Linux, `http://omscache.localhost/...`
//! em Windows) e uma string montada a mao no cliente e um 404 silencioso a
//! espera de acontecer. E o Rust que a injecta.

use super::SCHEME;

/// As duas implementacoes existem sempre, mas cada plataforma so constroi uma;
/// `url_for` nao tem consumidor em Rust porque e o JS que concatena a origem
/// com o caminho (o `LocalFileIndex.get` tem de ser sincrono). O `allow` fica
/// para nao apagar a costura pela qual o servidor de loopback do Linux entra,
/// que e o bilhete seguinte e nao um remendo futuro.
#[allow(dead_code)]
pub trait MediaServer {
    fn available(&self) -> bool;
    fn url_for(&self, path: &str) -> String;
}

/// macOS e Windows: o protocolo proprio do webview serve media a serio.
pub struct CustomProtocolServer;

impl MediaServer for CustomProtocolServer {
    fn available(&self) -> bool {
        true
    }

    fn url_for(&self, path: &str) -> String {
        format!("{}{}", origin(), path)
    }
}

/// Linux v1: indisponivel de proposito (ver o cabecalho). O `url_for` devolve
/// vazio para qualquer tentativa de uso ser um erro barulhento e nao um
/// elemento de media que nunca comeca.
#[allow(dead_code)]
pub struct LoopbackServer;

impl MediaServer for LoopbackServer {
    fn available(&self) -> bool {
        false
    }

    fn url_for(&self, _path: &str) -> String {
        String::new()
    }
}

pub fn origin() -> String {
    if cfg!(target_os = "windows") {
        format!("http://{SCHEME}.localhost")
    } else {
        format!("{SCHEME}://localhost")
    }
}

pub fn available() -> bool {
    server().available()
}

pub fn server() -> &'static dyn MediaServer {
    #[cfg(target_os = "linux")]
    {
        &LoopbackServer
    }
    #[cfg(not(target_os = "linux"))]
    {
        &CustomProtocolServer
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_origin_matches_the_platform() {
        let origin = origin();
        if cfg!(target_os = "windows") {
            assert_eq!(origin, "http://omscache.localhost");
        } else {
            assert_eq!(origin, "omscache://localhost");
        }
        // Sem barra no fim: o JS junta `${origin}/k/${chave}` e duas barras
        // seguidas dariam um caminho que o parser recusa.
        assert!(!origin.ends_with('/'));
    }

    #[test]
    fn linux_is_deliberately_unavailable() {
        assert_eq!(available(), !cfg!(target_os = "linux"));
    }
}
