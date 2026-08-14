//! O protocolo `omscache://`. Duas formas de caminho, ambas validadas ANTES de
//! alguma coisa tocar no disco:
//!
//! ```text
//! /k/<chave>      chave = "<songKey>_<kind>"   ^[0-9]+_(mixed|mixed_original|artwork|vocal|instrumental)$
//! /m/<mediaId>    mediaId                      ^[0-9]{1,32}$
//! ```
//!
//! A resolucao e sempre pela mesma escada: descodificar percent-encoding,
//! validar, procurar a LINHA no indice, juntar `root + rel_path`, canonicalizar
//! e exigir que continue debaixo do root. Nenhum caminho de ficheiro atravessa
//! o IPC em nenhum sentido: o JS so conhece URLs.
//!
//! Registado com `register_asynchronous_uri_scheme_protocol` e servido numa
//! thread propria. A variante sincrona corre na thread da UI e faria a janela
//! engasgar-se a cada seek, que e precisamente o gesto que este protocolo
//! existe para tornar instantaneo.
//!
//! Sobre o tamanho das respostas: o wry nao tem corpo de resposta em streaming
//! (wry#1022 continua aberto), portanto CADA resposta e um `Vec<u8>` inteiro
//! em memoria. O protocolo `asset:` embutido do Tauri responde a um GET sem
//! Range com o ficheiro TODO - e assim que um ficheiro de 700 MB vira 700 MB
//! de RSS. Aqui isso nao acontece nunca: audio sai as fatias de 512 KiB.

use http_range::HttpRange;
use tauri::http::header::*;
use tauri::http::{Method, Request, Response, StatusCode};
use std::io::{Read, Seek, SeekFrom};
use tauri::{Runtime, UriSchemeContext, UriSchemeResponder};

use super::index::{self, FileRow};
use super::paths;
use super::{CacheState, FileKey, Kind};

/// Fatia maxima por resposta. O `asset:` do Tauri usa 1 MiB; 512 KiB corta a
/// memoria de pico por pedido em voo a metade a troco de mais idas e voltas,
/// que para audio e a troca certa.
pub const MAX_LEN: u64 = 512 * 1024;

/// Artwork e servida INTEIRA (ate este tecto de sanidade). Um `<img>` nao sabe
/// pedir a continuacao de um 206, ao contrario de um elemento de media; cortar
/// uma capa a 512 KiB dava uma imagem meia desenhada. Capas reais tem dezenas
/// de KB, por isso este ramo e o normal e nao a excepcao.
pub const ARTWORK_FULL_MAX: u64 = 8 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum Target {
    Key(FileKey),
    Media(String),
}

/// Descodifica e valida. Feito a mao, sem crate de regex: a gramatica sao
/// digitos e cinco palavras, e uma dependencia nova para isto seria pior do
/// que o problema.
pub fn parse_target(raw_path: &str) -> Option<Target> {
    let decoded = percent_encoding::percent_decode(raw_path.as_bytes())
        .decode_utf8()
        .ok()?
        .to_string();
    // Descodificar PRIMEIRO e validar DEPOIS: ao contrario, um `%2e%2e%2f`
    // passava pela validacao como texto inofensivo e so virava `../` a
    // caminho do disco.
    let rest = decoded.strip_prefix('/')?;
    let (prefix, value) = rest.split_once('/')?;
    if value.is_empty() || value.len() > 64 || value.contains('/') {
        return None;
    }
    match prefix {
        "k" => {
            // song_key e so digitos, por isso partir no PRIMEIRO `_` nunca e
            // ambiguo, mesmo com `mixed_original` do outro lado.
            let (song_key, kind) = value.split_once('_')?;
            if song_key.is_empty() || !song_key.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            let kind = Kind::parse(kind)?;
            Some(Target::Key(FileKey::new(song_key, kind)))
        }
        "m" => {
            if value.len() > 32 || !value.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            Some(Target::Media(value.to_string()))
        }
        _ => None,
    }
}

/// O que responder, decidido sem tocar no disco para poder ser testado a
/// serio. `whole` diz que este conteudo pode sair inteiro (artwork pequena).
#[derive(Debug, PartialEq, Eq)]
pub enum RangePlan {
    /// 200 com o corpo todo.
    Full { len: u64 },
    /// 206 com uma fatia; `total` e SEMPRE o tamanho real, nunca `*`.
    Partial { start: u64, end: u64, total: u64 },
    /// 416 com `Content-Range: bytes */<total>` e corpo vazio.
    Unsatisfiable { total: u64 },
}

pub fn plan_range(range_header: Option<&str>, total: u64, whole: bool) -> RangePlan {
    let Some(header) = range_header else {
        // Sem Range: o que couber inteiro sai inteiro; o resto sai como 206 da
        // cabeca do ficheiro. Um 206 aqui diz ao cliente o tamanho total E que
        // ha ranges, que e exactamente o que um elemento de media precisa de
        // saber para continuar. O que NUNCA acontece e um read_to_end.
        if whole || total <= MAX_LEN {
            return RangePlan::Full { len: total };
        }
        return RangePlan::Partial {
            start: 0,
            end: MAX_LEN - 1,
            total,
        };
    };

    if total == 0 {
        return RangePlan::Unsatisfiable { total };
    }
    let Ok(ranges) = HttpRange::parse(header, total) else {
        return RangePlan::Unsatisfiable { total };
    };
    // Multi-range -> 416. Elementos de media nunca pedem varios ranges, e
    // devolver so o primeiro em silencio (o que quase toda a gente faz) e pior
    // do que recusar: o cliente acha que recebeu tudo.
    if ranges.len() != 1 {
        return RangePlan::Unsatisfiable { total };
    }
    let range = ranges[0];
    if range.start >= total || range.length == 0 {
        return RangePlan::Unsatisfiable { total };
    }
    let requested_end = range.start + range.length - 1;
    let end = requested_end.min(total - 1).min(range.start + MAX_LEN - 1);
    RangePlan::Partial {
        start: range.start,
        end,
        total,
    }
}

fn content_type_for(row: &FileRow) -> String {
    if let Some(declared) = row.content_type.as_ref().filter(|c| !c.is_empty()) {
        return declared.clone();
    }
    match row.kind {
        Kind::Artwork => "image/jpeg".to_string(),
        _ => "application/octet-stream".to_string(),
    }
}

fn empty(status: StatusCode, origin: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, origin)
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// O handler. Corre numa thread propria: leitura de disco na thread da UI
/// engasga a janela a cada seek.
pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    std::thread::spawn(move || {
        responder.respond(serve(&app, &request));
    });
}

fn serve<R: Runtime>(app: &tauri::AppHandle<R>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    use tauri::Manager;

    // Sem `crossOrigin` num elemento de media o CORS nem se aplica; devolver o
    // Origin do pedido cobre o caso em que se aplica (fetch/XHR da app) sem
    // fixar uma origem que muda entre dev (localhost:8081) e producao.
    let origin = request
        .headers()
        .get(ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("*")
        .to_string();

    let Some(target) = parse_target(request.uri().path()) else {
        return empty(StatusCode::BAD_REQUEST, &origin);
    };

    let state = app.state::<CacheState>();
    let Some(session) = state.current() else {
        return empty(StatusCode::NOT_FOUND, &origin);
    };

    let row = {
        let Ok(db) = session.db.lock() else {
            return empty(StatusCode::INTERNAL_SERVER_ERROR, &origin);
        };
        match &target {
            Target::Key(key) => index::get_file(&db, key),
            Target::Media(media_id) => index::resolve_media(&db, media_id),
        }
    };
    let Some(row) = row.filter(|r| matches!(r.status, super::FileStatus::Done)) else {
        return empty(StatusCode::NOT_FOUND, &origin);
    };

    let key = row.key();
    let Some(path) = paths::resolve_within(session.roots.dir(row.root), &row.rel_path) else {
        // O indice e ADVISORY: um ficheiro que desapareceu por tras das
        // costas da app (purga do macOS, limpeza do utilizador) nao pode
        // deixar uma linha a mentir para sempre. Apagar aqui e o que faz a
        // linha auto-curar-se em vez de dar 404 eterno.
        if let Ok(db) = session.db.lock() {
            index::delete_file(&db, &key);
        }
        state.events.forget(&key);
        return empty(StatusCode::NOT_FOUND, &origin);
    };

    let Ok(metadata) = std::fs::metadata(&path) else {
        if let Ok(db) = session.db.lock() {
            index::delete_file(&db, &key);
        }
        state.events.forget(&key);
        return empty(StatusCode::NOT_FOUND, &origin);
    };
    let total = metadata.len();

    // Contador de servico: enquanto isto estiver acima de zero o despejo salta
    // esta chave. Um fd aberto sobrevive ao unlink em macOS/Linux, mas o
    // PROXIMO pedido de range abre por caminho e apanhava 404 a meio do seek.
    session.serving_begin(&key);
    let response = build(request, &row, &path, total, &origin);
    session.serving_end(&key);
    // O toque de acesso e ADIADO: uma faixa de cinco minutos gera dezenas de
    // pedidos de range e um UPDATE por pedido era uma tempestade de escritas.
    session.note_touch(key);
    response
}

fn build(
    request: &Request<Vec<u8>>,
    row: &FileRow,
    path: &std::path::Path,
    total: u64,
    origin: &str,
) -> Response<Vec<u8>> {
    let content_type = content_type_for(row);
    let etag = row
        .etag
        .clone()
        .unwrap_or_else(|| format!("\"{}-{}\"", row.media_id, total));
    let head = request.method() == Method::HEAD;

    let base = || {
        Response::builder()
            .header(ACCESS_CONTROL_ALLOW_ORIGIN, origin)
            .header(ACCESS_CONTROL_EXPOSE_HEADERS, "content-range")
            // `Accept-Ranges` em TODAS as respostas, incluindo o primeiro 200:
            // e assim que o elemento de media sabe que pode fazer seek antes
            // de ter tentado uma vez.
            .header(ACCEPT_RANGES, "bytes")
            .header(CONTENT_TYPE, content_type.clone())
            .header(ETAG, etag.clone())
    };

    if head {
        return base()
            .status(StatusCode::OK)
            .header(CONTENT_LENGTH, total)
            .body(Vec::new())
            .unwrap_or_else(|_| empty(StatusCode::INTERNAL_SERVER_ERROR, origin));
    }

    let range_header = request
        .headers()
        .get(RANGE)
        .and_then(|value| value.to_str().ok());
    let whole = row.kind == Kind::Artwork && total <= ARTWORK_FULL_MAX;

    match plan_range(range_header, total, whole) {
        RangePlan::Unsatisfiable { total } => base()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(CONTENT_RANGE, format!("bytes */{total}"))
            .body(Vec::new())
            .unwrap_or_else(|_| empty(StatusCode::INTERNAL_SERVER_ERROR, origin)),
        RangePlan::Full { len } => match read_slice(path, 0, len) {
            Some(body) => base()
                .status(StatusCode::OK)
                .header(CONTENT_LENGTH, body.len())
                .body(body)
                .unwrap_or_else(|_| empty(StatusCode::INTERNAL_SERVER_ERROR, origin)),
            None => empty(StatusCode::NOT_FOUND, origin),
        },
        RangePlan::Partial { start, end, total } => {
            let len = end + 1 - start;
            match read_slice(path, start, len) {
                Some(body) => base()
                    .status(StatusCode::PARTIAL_CONTENT)
                    // O total e SEMPRE o real, nunca `*`: e daqui que o
                    // elemento de media tira a duracao antes de decodificar.
                    .header(CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
                    // Content-Length e o tamanho da FATIA, nao o do ficheiro.
                    .header(CONTENT_LENGTH, body.len())
                    .body(body)
                    .unwrap_or_else(|_| empty(StatusCode::INTERNAL_SERVER_ERROR, origin)),
                None => empty(StatusCode::NOT_FOUND, origin),
            }
        }
    }
}

fn read_slice(path: &std::path::Path, start: u64, len: u64) -> Option<Vec<u8>> {
    let mut file = std::fs::File::open(path).ok()?;
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut buffer = Vec::with_capacity(len as usize);
    file.take(len).read_to_end(&mut buffer).ok()?;
    Some(buffer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::index::FileRow;
    use crate::cache::paths::Root;
    use crate::cache::FileStatus;

    /// Ficheiro esparso de 10 MB: o `set_len` nao escreve nada em disco e as
    /// leituras devolvem zeros, que e tudo o que estes testes precisam.
    fn sparse_file(name: &str, len: u64) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("oms-protocol-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(len).unwrap();
        path
    }

    fn row(kind: Kind) -> FileRow {
        FileRow {
            song_key: "123".into(),
            kind,
            status: FileStatus::Done,
            media_id: "42".into(),
            root: Root::Pinned,
            rel_path: "123_mixed.m4a".into(),
            content_type: Some("audio/mp4".into()),
            etag: None,
            bytes: 0,
            progress: 1.0,
            predicted: false,
            updated_at: 0,
        }
    }

    fn request(method: Method, range: Option<&str>) -> Request<Vec<u8>> {
        let mut builder = Request::builder()
            .method(method)
            .uri("omscache://localhost/k/123_mixed");
        if let Some(range) = range {
            builder = builder.header(RANGE, range);
        }
        builder.body(Vec::new()).unwrap()
    }

    fn header(response: &Response<Vec<u8>>, name: HeaderName) -> &str {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
    }

    const TEN_MB_FILE: u64 = 10 * 1024 * 1024;

    #[test]
    fn an_open_ended_range_gets_a_206_with_the_real_total() {
        let path = sparse_file("open-ended.bin", TEN_MB_FILE);
        let response = build(
            &request(Method::GET, Some("bytes=0-")),
            &row(Kind::Mixed),
            &path,
            TEN_MB_FILE,
            "*",
        );
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            header(&response, CONTENT_RANGE),
            "bytes 0-524287/10485760"
        );
        // Content-Length e o da FATIA, nao o do ficheiro.
        assert_eq!(header(&response, CONTENT_LENGTH), "524288");
        assert_eq!(response.body().len(), 524_288);
        // Accept-Ranges em TODAS as respostas.
        assert_eq!(header(&response, ACCEPT_RANGES), "bytes");
        // Sem etag do servidor, um derivado estavel de (media id, tamanho).
        assert_eq!(header(&response, ETAG), "\"42-10485760\"");
    }

    #[test]
    fn a_range_at_the_end_of_the_file_gets_a_416_with_an_empty_body() {
        let path = sparse_file("past-end.bin", TEN_MB_FILE);
        let response = build(
            &request(Method::GET, Some(&format!("bytes={TEN_MB_FILE}-"))),
            &row(Kind::Mixed),
            &path,
            TEN_MB_FILE,
            "*",
        );
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(header(&response, CONTENT_RANGE), "bytes */10485760");
        assert!(response.body().is_empty());
    }

    #[test]
    fn a_head_answers_headers_and_no_body() {
        let path = sparse_file("head.bin", TEN_MB_FILE);
        let response = build(
            &request(Method::HEAD, None),
            &row(Kind::Mixed),
            &path,
            TEN_MB_FILE,
            "*",
        );
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(header(&response, CONTENT_LENGTH), "10485760");
        assert_eq!(header(&response, ACCEPT_RANGES), "bytes");
        assert!(response.body().is_empty());
    }

    #[test]
    fn a_multi_range_request_is_refused() {
        let path = sparse_file("multi.bin", TEN_MB_FILE);
        let response = build(
            &request(Method::GET, Some("bytes=0-99,200-299")),
            &row(Kind::Mixed),
            &path,
            TEN_MB_FILE,
            "*",
        );
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    }

    #[test]
    fn artwork_comes_out_whole_even_without_a_range() {
        let size = 300 * 1024;
        let path = sparse_file("cover.jpg", size);
        let mut artwork = row(Kind::Artwork);
        artwork.content_type = Some("image/jpeg".into());
        let response = build(&request(Method::GET, None), &artwork, &path, size, "*");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body().len() as u64, size);
        assert_eq!(header(&response, CONTENT_TYPE), "image/jpeg");
    }

    #[test]
    fn parse_target_accepts_the_two_legal_shapes() {
        assert_eq!(
            parse_target("/k/123_mixed"),
            Some(Target::Key(FileKey::new("123", Kind::Mixed)))
        );
        assert_eq!(
            parse_target("/k/123_mixed_original"),
            Some(Target::Key(FileKey::new("123", Kind::MixedOriginal)))
        );
        assert_eq!(
            parse_target("/k/9_artwork"),
            Some(Target::Key(FileKey::new("9", Kind::Artwork)))
        );
        assert_eq!(parse_target("/m/42"), Some(Target::Media("42".into())));
    }

    #[test]
    fn parse_target_rejects_everything_else() {
        assert_eq!(parse_target("/k/../etc/passwd"), None);
        assert_eq!(parse_target("/k/123_mixed/../x"), None);
        // O `..%2f` so vira `../` DEPOIS de descodificado; por isso e que a
        // descodificacao vem primeiro e a validacao depois.
        assert_eq!(parse_target("/k/%2e%2e%2fetc"), None);
        assert_eq!(parse_target("/k/"), None);
        assert_eq!(parse_target("/k/abc_mixed"), None);
        assert_eq!(parse_target("/k/123_stems"), None);
        assert_eq!(parse_target("/m/42a"), None);
        assert_eq!(parse_target("/m/"), None);
        assert_eq!(parse_target(&format!("/m/{}", "1".repeat(33))), None);
        assert_eq!(parse_target(&format!("/k/{}_mixed", "1".repeat(200))), None);
        assert_eq!(parse_target(""), None);
        assert_eq!(parse_target("/"), None);
        assert_eq!(parse_target("/x/123_mixed"), None);
    }

    const TEN_MB: u64 = 10 * 1024 * 1024;

    #[test]
    fn open_ended_range_is_capped_at_max_len() {
        assert_eq!(
            plan_range(Some("bytes=0-"), TEN_MB, false),
            RangePlan::Partial {
                start: 0,
                end: MAX_LEN - 1,
                total: TEN_MB
            }
        );
        // 0-524287 sao 524288 bytes: o Content-Length e o da fatia.
        assert_eq!(MAX_LEN, 524_288);
    }

    #[test]
    fn a_range_past_the_end_is_unsatisfiable() {
        assert_eq!(
            plan_range(Some(&format!("bytes={TEN_MB}-")), TEN_MB, false),
            RangePlan::Unsatisfiable { total: TEN_MB }
        );
    }

    #[test]
    fn a_mid_file_range_keeps_the_real_total() {
        assert_eq!(
            plan_range(Some("bytes=1000-1999"), TEN_MB, false),
            RangePlan::Partial {
                start: 1000,
                end: 1999,
                total: TEN_MB
            }
        );
    }

    #[test]
    fn multi_range_is_refused_rather_than_half_answered() {
        assert_eq!(
            plan_range(Some("bytes=0-99,200-299"), TEN_MB, false),
            RangePlan::Unsatisfiable { total: TEN_MB }
        );
    }

    #[test]
    fn a_rangeless_get_never_reads_the_whole_big_file() {
        assert_eq!(
            plan_range(None, TEN_MB, false),
            RangePlan::Partial {
                start: 0,
                end: MAX_LEN - 1,
                total: TEN_MB
            }
        );
        // Pequeno o suficiente: sai inteiro, sem idas e voltas.
        assert_eq!(plan_range(None, 4_096, false), RangePlan::Full { len: 4_096 });
        // Artwork sai sempre inteira, porque um <img> nao continua um 206.
        assert_eq!(
            plan_range(None, 2 * MAX_LEN, true),
            RangePlan::Full { len: 2 * MAX_LEN }
        );
    }

    #[test]
    fn a_garbage_range_header_is_unsatisfiable_not_a_full_body() {
        assert_eq!(
            plan_range(Some("bytes=abc"), TEN_MB, false),
            RangePlan::Unsatisfiable { total: TEN_MB }
        );
        assert_eq!(
            plan_range(Some("bytes=0-"), 0, false),
            RangePlan::Unsatisfiable { total: 0 }
        );
    }
}
