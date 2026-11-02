//! Login (e ligar o Spotify) pelo browser do sistema, com o regresso num
//! endereco local (RFC 8252, "loopback redirect").
//!
//! O webview do Tauri nao abre o popup que a web usa (`window.open` nao cria
//! janela nenhuma) e o esquema `tauri://localhost` nao esta na lista de
//! regressos do backend. O backend ja aceita `http://127.0.0.1:<porta>` como
//! `app_origin` (e o mesmo caminho do Expo em dev), por isso o shell:
//!
//! 1. escuta em 127.0.0.1 numa porta livre;
//! 2. abre o URL pedido no browser do sistema com `app_origin` = essa origem
//!    (o id, as passkeys e os cookies do browser valem como no iOS);
//! 3. o backend devolve para `http://127.0.0.1:<porta>/oauth/callback?ticket=`
//!    (ou `/?spotify=linked`); o shell responde "pode voltar a app" e
//!    entrega o URL inteiro ao JS, que o le com o mesmo parser da web.
//!
//! So um pedido de cada vez: um segundo clique em Entrar cancela o anterior.
//! O bilhete vive 2 min e so serve com o `POST /music/auth/adopt`.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use tauri::{Manager, Runtime};

/// Cada pedido leva um numero; quando chega um mais novo, o antigo desiste.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// A tentativa de login no backend vive 10 min; esperar mais nao serve.
const WAIT: Duration = Duration::from_secs(10 * 60);

const PAGE: &str = "<!doctype html><html lang=\"pt\"><meta charset=\"utf-8\">\
<title>OMS Music</title><body style=\"font-family:-apple-system,system-ui,sans-serif;\
display:flex;align-items:center;justify-content:center;height:100vh;margin:0\">\
<p style=\"font-size:20px\">Pronto. Pode voltar à OMS Music e fechar esta janela.</p>\
<script>setTimeout(function(){window.close()},500)</script></body></html>";

/// So para o backend da musica (ou um backend local em dev): o shell nunca
/// abre um URL arbitrario que o webview lhe passe.
fn allowed(url: &str) -> bool {
    url.starts_with("https://backend.omelhorsite.pt/")
        || url.starts_with("http://localhost:")
        || url.starts_with("http://127.0.0.1:")
}

fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn open_in_browser(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = std::process::Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    command.arg(url).spawn().map(|_| ())
}

/// Le a linha do pedido (`GET /caminho?query HTTP/1.1`) e devolve o caminho.
fn request_path(stream: &mut TcpStream) -> Option<String> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let mut buf = [0u8; 8192];
    let mut len = 0;
    while len < buf.len() {
        let n = stream.read(&mut buf[len..]).ok()?;
        if n == 0 {
            break;
        }
        len += n;
        if buf[..len].windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    let head = String::from_utf8_lossy(&buf[..len]);
    let line = head.lines().next()?;
    let mut parts = line.split(' ');
    if parts.next()? != "GET" {
        return None;
    }
    Some(parts.next()?.to_string())
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.flush();
}

/// O regresso e o primeiro pedido com query (`?ticket=`, `?error=`,
/// `?spotify=`); o resto (favicon, pre-carregamentos) leva 404.
fn wait_for_return(listener: TcpListener, generation: u64, origin: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + WAIT;
    while Instant::now() < deadline {
        if GENERATION.load(Ordering::SeqCst) != generation {
            return Err("cancelled".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                match request_path(&mut stream) {
                    Some(path) if path.contains('?') && !path.starts_with("/favicon") => {
                        respond(&mut stream, "200 OK", PAGE);
                        return Ok(format!("{origin}{path}"));
                    }
                    _ => respond(&mut stream, "404 Not Found", ""),
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("timeout".into())
}

/// Abre `start_url` no browser do sistema com `app_origin` = um endereco
/// local e devolve o URL do regresso (`http://127.0.0.1:<porta>/...`).
/// Erros: `cancelled` (outro pedido tomou o lugar), `timeout`, ou o motivo.
#[tauri::command]
#[specta::specta]
pub async fn browser_login<R: Runtime>(
    webview: tauri::Webview<R>,
    start_url: String,
) -> Result<String, String> {
    if webview.label() != "main" {
        return Err("comando indisponivel nesta janela".into());
    }
    if !allowed(&start_url) {
        return Err("url recusado".into());
    }
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let origin = format!("http://127.0.0.1:{port}");
    let separator = if start_url.contains('?') { '&' } else { '?' };
    let url = format!("{start_url}{separator}app_origin={}", encode(&origin));
    open_in_browser(&url).map_err(|e| e.to_string())?;

    let result = tauri::async_runtime::spawn_blocking(move || {
        wait_for_return(listener, generation, &origin)
    })
    .await
    .map_err(|e| e.to_string())?;

    if result.is_ok() {
        if let Some(window) = webview.app_handle().get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_music_backend_or_a_local_one() {
        assert!(allowed("https://backend.omelhorsite.pt/music/auth/start"));
        assert!(allowed("http://localhost:3000/music/auth/start"));
        assert!(!allowed("https://backend.omelhorsite.pt.evil.com/x"));
        assert!(!allowed("file:///etc/passwd"));
    }

    #[test]
    fn encodes_the_origin() {
        assert_eq!(encode("http://127.0.0.1:5000"), "http%3A%2F%2F127.0.0.1%3A5000");
    }

    #[test]
    fn hands_back_the_first_return_with_a_query() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let origin = format!("http://127.0.0.1:{port}");
        let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        let client = std::thread::spawn(move || {
            for path in ["/favicon.ico", "/oauth/callback?ticket=abc"] {
                let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
                write!(s, "GET {path} HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
                let mut out = String::new();
                let _ = s.read_to_string(&mut out);
            }
        });
        let url = wait_for_return(listener, generation, &origin).unwrap();
        client.join().unwrap();
        assert_eq!(url, format!("{origin}/oauth/callback?ticket=abc"));
    }
}

/// Contra o backend real (rede): `cargo test --lib login::live -- --ignored`.
/// Faz o caminho do browser com o curl, recusando no id (`error=`), e
/// confirma que o regresso chega a este shell.
#[cfg(test)]
mod live {
    use super::*;

    #[test]
    #[ignore]
    fn the_backend_returns_to_the_shell() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        let start = format!(
            "https://backend.omelhorsite.pt/music/auth/start?app_origin={}",
            encode(&origin)
        );
        let browser = std::thread::spawn(move || {
            let jar = std::env::temp_dir().join(format!("oms-login-live-{}", std::process::id()));
            let curl = |url: &str| {
                let out = std::process::Command::new("curl")
                    .args(["-s", "-m", "15", "-o", "/dev/null", "-w", "%{redirect_url}", "-c"])
                    .arg(&jar)
                    .arg("-b")
                    .arg(&jar)
                    .arg(url)
                    .output()
                    .unwrap();
                String::from_utf8(out.stdout).unwrap()
            };
            let to_id = curl(&start);
            assert!(to_id.starts_with("https://id.omelhorsite.pt/"), "{to_id}");
            let state = to_id.split("state=").nth(1).unwrap().split('&').next().unwrap().to_string();
            let back = curl(&format!(
                "https://backend.omelhorsite.pt/music/auth/callback?state={state}&error=access_denied"
            ));
            let _ = std::fs::remove_file(&jar);
            std::process::Command::new("curl").args(["-s", "-m", "5", &back]).output().unwrap();
        });
        let url = wait_for_return(listener, generation, &origin).unwrap();
        browser.join().unwrap();
        assert!(url.starts_with(&format!("{origin}/oauth/callback?error=")), "{url}");
    }
}
