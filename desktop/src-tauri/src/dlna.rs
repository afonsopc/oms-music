//! TVs e colunas DLNA/UPnP (Samsung, LG, Sony, Philips, Kodi, ...) para o
//! "Transmitir" da app (src/cast/drivers/dlna.ts em oms-music).
//!
//!  - Descoberta: M-SEARCH SSDP por MediaRenderer, depois a descricao XML de
//!    cada um (nome, fabricante, URLs de controlo do AVTransport e do
//!    RenderingControl).
//!  - Tocar: SetAVTransportURI + Play por SOAP; pausa, procurar, parar,
//!    volume e o estado (GetTransportInfo/GetPositionInfo/GetVolume), que a
//!    app pergunta uma vez por segundo enquanto transmite.
//!  - Proxy local: muitas TVs DLNA nao abrem HTTPS (os URLs assinados do
//!    armazenamento sao HTTPS) nem gostam de URLs com 1 KB de assinatura. A
//!    TV recebe `http://<ip-deste-computador>:<porta>/s/<token>`; o token e
//!    aleatorio, so existe para URLs que a app registou (nunca um proxy
//!    aberto) e o Range passa para o armazenamento, para a TV poder saltar.
//!
//! Sem fila nativa: a TV toca uma musica de cada vez e e a app que manda a
//! seguinte quando ela acaba.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Runtime, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const MAIN_WINDOW: &str = "main";
const SSDP_ADDR: &str = "239.255.255.250:1900";
const AV_TRANSPORT: &str = "urn:schemas-upnp-org:service:AVTransport:1";
const RENDERING_CONTROL: &str = "urn:schemas-upnp-org:service:RenderingControl:1";
/// Os URLs assinados duram 24 h; o token do proxy nao precisa de mais.
const TOKEN_TTL: Duration = Duration::from_secs(24 * 3600);

fn guard<R: Runtime>(webview: &tauri::Webview<R>) -> Result<(), String> {
    if webview.label() == MAIN_WINDOW {
        Ok(())
    } else {
        Err("comando indisponivel nesta janela".into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DlnaDevice {
    /// O LOCATION do SSDP: unico por aparelho e estavel enquanto o IP for.
    pub id: String,
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    #[serde(skip)]
    av_transport_url: String,
    #[serde(skip)]
    rendering_url: Option<String>,
    #[serde(skip)]
    host: Option<IpAddr>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DlnaMedia {
    pub url: String,
    pub content_type: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub artwork_url: Option<String>,
    pub duration_s: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DlnaStatus {
    /// PLAYING, PAUSED_PLAYBACK, STOPPED, TRANSITIONING, NO_MEDIA_PRESENT.
    pub state: String,
    pub position_s: f64,
    pub duration_s: f64,
    /// 0..100, quando a TV o diz.
    pub volume: Option<u32>,
}

struct ProxyEntry {
    upstream: String,
    content_type: String,
    created: Instant,
}

#[derive(Default)]
struct Proxy {
    port: Option<u16>,
    entries: HashMap<String, ProxyEntry>,
}

#[derive(Default)]
pub struct DlnaState {
    devices: Mutex<HashMap<String, DlnaDevice>>,
    proxy: Arc<Mutex<Proxy>>,
}

/// O mesmo provider do rustls que cache_open instala (ring), com a mesma
/// guarda: o proxy fala HTTPS com o armazenamento antes de haver cache.
fn ensure_crypto_provider() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

fn http() -> Result<reqwest::Client, String> {
    ensure_crypto_provider();
    reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// XML minimo: as descricoes UPnP sao pequenas e regulares, e um parser a
// serio por causa de seis tags seria uma dependencia nova sem ganho.
// ---------------------------------------------------------------------------

fn tag<'a>(xml: &'a str, name: &str) -> Option<&'a str> {
    let open_plain = format!("<{name}>");
    let start = if let Some(i) = xml.find(&open_plain) {
        i + open_plain.len()
    } else {
        // Com prefixo de namespace (<u:CurrentVolume>) ou atributos.
        let needle = format!(":{name}>");
        let i = xml.find(&needle)?;
        i + needle.len()
    };
    let rest = &xml[start..];
    let end = rest.find("</")?;
    Some(rest[..end].trim())
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn join_url(base: &str, path: &str) -> String {
    if path.starts_with("http://") || path.starts_with("https://") {
        return path.to_string();
    }
    let scheme_end = base.find("://").map(|i| i + 3).unwrap_or(0);
    let host_end = base[scheme_end..].find('/').map(|i| i + scheme_end).unwrap_or(base.len());
    let origin = &base[..host_end];
    if path.starts_with('/') {
        format!("{origin}{path}")
    } else {
        format!("{origin}/{path}")
    }
}

fn host_of(url: &str) -> Option<IpAddr> {
    let after = url.split("://").nth(1)?;
    let host_port = after.split('/').next()?;
    let host = host_port.rsplit_once(':').map(|(h, _)| h).unwrap_or(host_port);
    host.trim_matches(['[', ']']).parse().ok()
}

/// Os servicos de uma descricao: (serviceType, controlURL).
fn services(xml: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(i) = rest.find("<service>") {
        let block_start = i + "<service>".len();
        let Some(end) = rest[block_start..].find("</service>") else { break };
        let block = &rest[block_start..block_start + end];
        if let (Some(t), Some(c)) = (tag(block, "serviceType"), tag(block, "controlURL")) {
            out.push((t.to_string(), c.to_string()));
        }
        rest = &rest[block_start + end..];
    }
    out
}

fn ssdp_locations(wait: Duration) -> Vec<String> {
    let Ok(socket) = UdpSocket::bind("0.0.0.0:0") else { return Vec::new() };
    let _ = socket.set_read_timeout(Some(Duration::from_millis(250)));
    let _ = socket.set_multicast_ttl_v4(2);
    let mut found = Vec::new();
    for st in ["urn:schemas-upnp-org:device:MediaRenderer:1", AV_TRANSPORT] {
        let msg = format!(
            "M-SEARCH * HTTP/1.1\r\nHOST: {SSDP_ADDR}\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: {st}\r\n\r\n"
        );
        let _ = socket.send_to(msg.as_bytes(), SSDP_ADDR);
    }
    let deadline = Instant::now() + wait;
    let mut buf = [0u8; 2048];
    while Instant::now() < deadline {
        let Ok((n, _)) = socket.recv_from(&mut buf) else { continue };
        let text = String::from_utf8_lossy(&buf[..n]);
        for line in text.lines() {
            if let Some((k, v)) = line.split_once(':') {
                if k.trim().eq_ignore_ascii_case("location") {
                    let loc = v.trim().to_string();
                    if !found.contains(&loc) {
                        found.push(loc);
                    }
                }
            }
        }
    }
    found
}

async fn describe(client: &reqwest::Client, location: &str) -> Option<DlnaDevice> {
    let xml = client.get(location).send().await.ok()?.text().await.ok()?;
    let base = tag(&xml, "URLBase").map(str::to_string).unwrap_or_else(|| location.to_string());
    let svcs = services(&xml);
    let av = svcs.iter().find(|(t, _)| t.starts_with("urn:schemas-upnp-org:service:AVTransport"))?;
    let rc = svcs.iter().find(|(t, _)| t.starts_with("urn:schemas-upnp-org:service:RenderingControl"));
    Some(DlnaDevice {
        id: location.to_string(),
        name: tag(&xml, "friendlyName").map(unescape).unwrap_or_else(|| "TV".into()),
        manufacturer: tag(&xml, "manufacturer").map(unescape),
        model: tag(&xml, "modelName").map(unescape),
        av_transport_url: join_url(&base, &av.1),
        rendering_url: rc.map(|(_, c)| join_url(&base, c)),
        host: host_of(location),
    })
}

async fn soap(
    client: &reqwest::Client,
    url: &str,
    service: &str,
    action: &str,
    args: &str,
) -> Result<String, String> {
    let body = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">\
<s:Body><u:{action} xmlns:u=\"{service}\">{args}</u:{action}></s:Body></s:Envelope>"
    );
    let res = client
        .post(url)
        .header("Content-Type", "text/xml; charset=\"utf-8\"")
        .header("SOAPACTION", format!("\"{service}#{action}\""))
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let code = tag(&text, "errorCode").unwrap_or("?").to_string();
        return Err(format!("{action}: HTTP {status} (UPnP {code})"));
    }
    Ok(text)
}

fn hms(seconds: f64) -> String {
    let s = seconds.max(0.0).round() as u64;
    format!("{}:{:02}:{:02}", s / 3600, (s / 60) % 60, s % 60)
}

fn parse_hms(s: &str) -> f64 {
    let main = s.split('.').next().unwrap_or("");
    let parts: Vec<f64> = main.split(':').filter_map(|p| p.trim().parse().ok()).collect();
    match parts.as_slice() {
        [h, m, s] => h * 3600.0 + m * 60.0 + s,
        [m, s] => m * 60.0 + s,
        [s] => *s,
        _ => 0.0,
    }
}

fn random_token() -> String {
    // RandomState e semeado pelo SO a cada instancia: duas dao 128 bits que
    // ninguem na rede adivinha, sem uma dependencia nova so para isto.
    let mut out = String::new();
    for _ in 0..2 {
        let mut h = RandomState::new().build_hasher();
        h.write_u128(Instant::now().elapsed().as_nanos());
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

/// O IP deste computador visto do lado da TV (a interface pela qual se vai).
fn local_ip_towards(target: IpAddr) -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect(SocketAddr::new(target, 9)).ok()?;
    Some(socket.local_addr().ok()?.ip())
}

// ---------------------------------------------------------------------------
// Proxy
// ---------------------------------------------------------------------------

async fn ensure_proxy(proxy: Arc<Mutex<Proxy>>) -> Result<u16, String> {
    if let Some(port) = proxy.lock().map_err(|e| e.to_string())?.port {
        return Ok(port);
    }
    let listener = TcpListener::bind("0.0.0.0:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    proxy.lock().map_err(|e| e.to_string())?.port = Some(port);
    let shared = proxy.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else { continue };
            let shared = shared.clone();
            tauri::async_runtime::spawn(async move {
                let _ = serve(stream, shared).await;
            });
        }
    });
    Ok(port)
}

async fn serve(mut stream: TcpStream, proxy: Arc<Mutex<Proxy>>) -> Result<(), String> {
    let mut head = Vec::with_capacity(2048);
    let mut buf = [0u8; 1024];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
        if n == 0 || head.len() > 16 * 1024 {
            return Ok(());
        }
        head.extend_from_slice(&buf[..n]);
    }
    let text = String::from_utf8_lossy(&head).to_string();
    let mut lines = text.split("\r\n");
    let request = lines.next().unwrap_or("");
    let mut parts = request.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    let mut range: Option<String> = None;
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("range") {
                range = Some(v.trim().to_string());
            }
        }
    }
    let token = path.strip_prefix("/s/").unwrap_or("").to_string();
    let entry = {
        let mut p = proxy.lock().map_err(|e| e.to_string())?;
        p.entries.retain(|_, e| e.created.elapsed() < TOKEN_TTL);
        p.entries.get(&token).map(|e| (e.upstream.clone(), e.content_type.clone()))
    };
    let Some((upstream, content_type)) = entry.filter(|_| method == "GET" || method == "HEAD") else {
        let _ = stream
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await;
        return Ok(());
    };
    ensure_crypto_provider();
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = if method == "HEAD" { client.head(&upstream) } else { client.get(&upstream) };
    if let Some(r) = &range {
        req = req.header("Range", r);
    }
    let res = match req.send().await {
        Ok(r) => r,
        Err(_) => {
            let _ = stream
                .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .await;
            return Ok(());
        }
    };
    let status = res.status();
    let mut out = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\
transferMode.dlna.org: Streaming\r\n\
contentFeatures.dlna.org: DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000\r\n",
        status.as_u16(),
        status.canonical_reason().unwrap_or(""),
        res.headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .filter(|v| !v.is_empty() && *v != "application/octet-stream")
            .unwrap_or(&content_type),
    );
    for name in ["content-length", "content-range"] {
        if let Some(v) = res.headers().get(name).and_then(|v| v.to_str().ok()) {
            out.push_str(&format!("{name}: {v}\r\n"));
        }
    }
    out.push_str("\r\n");
    stream.write_all(out.as_bytes()).await.map_err(|e| e.to_string())?;
    if method == "HEAD" {
        return Ok(());
    }
    use futures_util::StreamExt;
    let mut body = res.bytes_stream();
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if stream.write_all(&chunk).await.is_err() {
            break; // a TV fechou (procurou para outro sitio): normal
        }
    }
    Ok(())
}

fn register_url(proxy: &Arc<Mutex<Proxy>>, upstream: &str, content_type: &str) -> Result<String, String> {
    let token = random_token();
    proxy.lock().map_err(|e| e.to_string())?.entries.insert(
        token.clone(),
        ProxyEntry {
            upstream: upstream.to_string(),
            content_type: content_type.to_string(),
            created: Instant::now(),
        },
    );
    Ok(token)
}

fn device(state: &State<'_, DlnaState>, id: &str) -> Result<DlnaDevice, String> {
    state
        .devices
        .lock()
        .map_err(|e| e.to_string())?
        .get(id)
        .cloned()
        .ok_or_else(|| "aparelho desconhecido".to_string())
}

fn didl(media: &DlnaMedia, url: &str, art: Option<&str>) -> String {
    let duration = media
        .duration_s
        .filter(|d| *d > 0.0)
        .map(|d| format!(" duration=\"{}.000\"", hms(d)))
        .unwrap_or_default();
    let album = media
        .album
        .as_deref()
        .map(|a| format!("<upnp:album>{}</upnp:album>", escape(a)))
        .unwrap_or_default();
    let art = art
        .map(|a| format!("<upnp:albumArtURI>{}</upnp:albumArtURI>", escape(a)))
        .unwrap_or_default();
    format!(
        "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">\
<item id=\"1\" parentID=\"0\" restricted=\"1\"><dc:title>{}</dc:title><dc:creator>{}</dc:creator><upnp:artist>{}</upnp:artist>{album}{art}\
<upnp:class>object.item.audioItem.musicTrack</upnp:class>\
<res protocolInfo=\"http-get:*:{}:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000\"{duration}>{}</res></item></DIDL-Lite>",
        escape(&media.title),
        escape(&media.artist),
        escape(&media.artist),
        escape(&media.content_type),
        escape(url),
    )
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

#[tauri::command]
#[specta::specta]
pub async fn dlna_discover<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, DlnaState>,
) -> Result<Vec<DlnaDevice>, String> {
    guard(&webview)?;
    let locations = tauri::async_runtime::spawn_blocking(|| ssdp_locations(Duration::from_millis(2500)))
        .await
        .map_err(|e| e.to_string())?;
    let client = http()?;
    let mut found = Vec::new();
    for loc in locations {
        if let Some(d) = describe(&client, &loc).await {
            found.push(d);
        }
    }
    let mut devices = state.devices.lock().map_err(|e| e.to_string())?;
    for d in &found {
        devices.insert(d.id.clone(), d.clone());
    }
    Ok(found)
}

#[tauri::command]
#[specta::specta]
pub async fn dlna_load<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, DlnaState>,
    id: String,
    media: DlnaMedia,
    position_s: f64,
) -> Result<(), String> {
    guard(&webview)?;
    let d = device(&state, &id)?;
    let port = ensure_proxy(state.proxy.clone()).await?;
    let ip = d
        .host
        .and_then(local_ip_towards)
        .ok_or_else(|| "sem caminho para a TV".to_string())?;
    let base = match ip {
        IpAddr::V6(v6) => format!("http://[{v6}]:{port}"),
        IpAddr::V4(v4) => format!("http://{v4}:{port}"),
    };
    let url = format!("{base}/s/{}", register_url(&state.proxy, &media.url, &media.content_type)?);
    let art = match &media.artwork_url {
        Some(a) => Some(format!("{base}/s/{}", register_url(&state.proxy, a, "image/jpeg")?)),
        None => None,
    };
    let client = http()?;
    // Algumas TVs recusam um SetAVTransportURI com outra coisa a tocar.
    let _ = soap(&client, &d.av_transport_url, AV_TRANSPORT, "Stop", "<InstanceID>0</InstanceID>").await;
    let args = format!(
        "<InstanceID>0</InstanceID><CurrentURI>{}</CurrentURI><CurrentURIMetaData>{}</CurrentURIMetaData>",
        escape(&url),
        escape(&didl(&media, &url, art.as_deref())),
    );
    soap(&client, &d.av_transport_url, AV_TRANSPORT, "SetAVTransportURI", &args).await?;
    soap(&client, &d.av_transport_url, AV_TRANSPORT, "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>").await?;
    if position_s > 1.0 {
        // Muitas TVs so aceitam o Seek depois de comecarem a tocar.
        tokio::time::sleep(Duration::from_millis(1200)).await;
        let seek = format!("<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>{}</Target>", hms(position_s));
        let _ = soap(&client, &d.av_transport_url, AV_TRANSPORT, "Seek", &seek).await;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn dlna_control<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, DlnaState>,
    id: String,
    action: String,
    value: Option<f64>,
) -> Result<(), String> {
    guard(&webview)?;
    let d = device(&state, &id)?;
    let client = http()?;
    match action.as_str() {
        "play" => soap(&client, &d.av_transport_url, AV_TRANSPORT, "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>").await,
        "pause" => soap(&client, &d.av_transport_url, AV_TRANSPORT, "Pause", "<InstanceID>0</InstanceID>").await,
        "stop" => soap(&client, &d.av_transport_url, AV_TRANSPORT, "Stop", "<InstanceID>0</InstanceID>").await,
        "seek" => {
            let seek = format!(
                "<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>{}</Target>",
                hms(value.unwrap_or(0.0))
            );
            soap(&client, &d.av_transport_url, AV_TRANSPORT, "Seek", &seek).await
        }
        "volume" => {
            let Some(rc) = d.rendering_url.as_deref() else { return Ok(()) };
            let v = (value.unwrap_or(0.0).clamp(0.0, 1.0) * 100.0).round() as u32;
            let args = format!("<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>{v}</DesiredVolume>");
            soap(&client, rc, RENDERING_CONTROL, "SetVolume", &args).await
        }
        _ => Err("accao desconhecida".into()),
    }
    .map(|_| ())
}

#[tauri::command]
#[specta::specta]
pub async fn dlna_status<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, DlnaState>,
    id: String,
) -> Result<DlnaStatus, String> {
    guard(&webview)?;
    let d = device(&state, &id)?;
    let client = http()?;
    let info = soap(&client, &d.av_transport_url, AV_TRANSPORT, "GetTransportInfo", "<InstanceID>0</InstanceID>").await?;
    let pos = soap(&client, &d.av_transport_url, AV_TRANSPORT, "GetPositionInfo", "<InstanceID>0</InstanceID>")
        .await
        .unwrap_or_default();
    let volume = match d.rendering_url.as_deref() {
        Some(rc) => soap(&client, rc, RENDERING_CONTROL, "GetVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel>")
            .await
            .ok()
            .and_then(|x| tag(&x, "CurrentVolume").and_then(|v| v.parse().ok())),
        None => None,
    };
    Ok(DlnaStatus {
        state: tag(&info, "CurrentTransportState").unwrap_or("STOPPED").to_string(),
        position_s: tag(&pos, "RelTime").map(parse_hms).unwrap_or(0.0),
        duration_s: tag(&pos, "TrackDuration").map(parse_hms).unwrap_or(0.0),
        volume,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_services_and_names() {
        let xml = "<root><URLBase>http://10.0.0.5:9197/</URLBase><device><friendlyName>Sala &amp; TV</friendlyName>\
<serviceList><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/rc</controlURL></service>\
<service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>upnp/control/AVTransport1</controlURL></service></serviceList></device></root>";
        let s = services(xml);
        assert_eq!(s.len(), 2);
        assert_eq!(unescape(tag(xml, "friendlyName").unwrap()), "Sala & TV");
        assert_eq!(join_url("http://10.0.0.5:9197/", &s[1].1), "http://10.0.0.5:9197/upnp/control/AVTransport1");
        assert_eq!(join_url("http://10.0.0.5:9197/desc.xml", "/rc"), "http://10.0.0.5:9197/rc");
        assert_eq!(host_of("http://10.0.0.5:9197/desc.xml"), "10.0.0.5".parse().ok());
    }

    #[test]
    fn times() {
        assert_eq!(hms(3725.4), "1:02:05");
        assert_eq!(parse_hms("0:03:15.250"), 195.0);
        assert_eq!(parse_hms("NOT_IMPLEMENTED"), 0.0);
    }

    #[test]
    fn prefixed_tags() {
        let xml = "<s:Body><u:GetVolumeResponse><CurrentVolume>17</CurrentVolume></u:GetVolumeResponse></s:Body>";
        assert_eq!(tag(xml, "CurrentVolume"), Some("17"));
    }

    #[test]
    fn tokens_differ() {
        assert_ne!(random_token(), random_token());
        assert_eq!(random_token().len(), 32);
    }
}

/// Contra a rede a serio: `OMS_DLNA_LIVE=1 cargo test live_ -- --ignored --nocapture`.
/// So leituras na TV (descoberta, estado, volume) - nunca poe nada a tocar -
/// e o proxy local com um Range a um ficheiro HTTPS.
#[cfg(test)]
mod live {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn live_discovery_and_status() {
        let locations = ssdp_locations(Duration::from_millis(2500));
        println!("SSDP: {locations:?}");
        let client = http().unwrap();
        for loc in locations {
            let Some(d) = describe(&client, &loc).await else { continue };
            println!("{} | {:?} {:?} | {}", d.name, d.manufacturer, d.model, d.av_transport_url);
            let info = soap(&client, &d.av_transport_url, AV_TRANSPORT, "GetTransportInfo", "<InstanceID>0</InstanceID>").await;
            println!("  estado: {:?}", info.as_deref().ok().and_then(|x| tag(x, "CurrentTransportState")));
            if let Some(rc) = &d.rendering_url {
                let v = soap(&client, rc, RENDERING_CONTROL, "GetVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel>").await;
                println!("  volume: {:?}", v.as_deref().ok().and_then(|x| tag(x, "CurrentVolume")));
            }
            println!("  ip local: {:?}", d.host.and_then(local_ip_towards));
        }
    }

    #[tokio::test]
    #[ignore]
    async fn live_proxy_range() {
        let upstream = std::env::var("OMS_DLNA_URL").unwrap_or_else(|_| "https://music.omelhorsite.pt/favicon.ico".into());
        let proxy = Arc::new(Mutex::new(Proxy::default()));
        let port = ensure_proxy(proxy.clone()).await.unwrap();
        let token = register_url(&proxy, &upstream, "audio/mp4").unwrap();
        ensure_crypto_provider();
        let client = reqwest::Client::new();
        let res = client
            .get(format!("http://127.0.0.1:{port}/s/{token}"))
            .header("Range", "bytes=0-99")
            .send()
            .await
            .unwrap();
        println!("status {} headers {:?}", res.status(), res.headers());
        let partial = res.status().as_u16() == 206;
        let body = res.bytes().await.unwrap();
        println!("bytes {}", body.len());
        assert!(!body.is_empty());
        // O favicon por defeito vem do Pages, que ignora o Range (200 inteiro);
        // com OMS_DLNA_URL num URL do Garage tem de vir 206 com 100 bytes.
        if partial {
            assert!(body.len() <= 100);
        }
        let bad = client.get(format!("http://127.0.0.1:{port}/s/nope")).send().await.unwrap();
        assert_eq!(bad.status().as_u16(), 404);
    }
}
