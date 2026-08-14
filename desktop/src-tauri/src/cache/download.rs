//! As transferencias. Escrita em streaming para um `.part`, `fsync` antes do
//! `rename`, e so DEPOIS a linha passa a `done`.
//!
//! O ramo que nao pode ser esquecido e o do `200 OK` numa retoma: se o
//! servidor responde 200 a um pedido com `Range`, o validador mudou e o corpo
//! e o ficheiro INTEIRO outra vez. Acrescentar esse corpo ao prefixo que ja
//! estava em disco produz um ficheiro que falha a descodificar num offset
//! aleatorio - a pior classe de bug deste desenho todo, porque parece
//! corrupcao de disco e nao um erro de logica. Por isso o 200 trunca.
//!
//! Concorrencia: um semaforo de 3, igual ao TRANSFER_CONCURRENCY do movel.
//! NAO ha slot dedicado ao preditivo. Uma fila com prioridades era a
//! alternativa e foi recusada: o preditivo fica SUSPENSO enquanto houver
//! transferencias explicitas, o que da o mesmo resultado e nao introduz
//! ordenacao nenhuma na fila.

use futures_util::StreamExt;
use reqwest::header::{CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG, IF_RANGE, RANGE};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

use super::events::EventHub;
use super::index::{self, FileRow};
use super::paths::Root;
use super::{
    evict, now_ms, FileKey, FileStatus, Kind, Session, Transfer, EVICTABLE_TTL_MS,
    MIN_PLAUSIBLE_AUDIO_BYTES,
};

/// Atraso da varredura de despejo depois de uma transferencia aterrar uma
/// linha orfa. Nao e magia: e so nao correr a varredura no meio de uma
/// sincronizacao grande, em que ela seria imediatamente invalidada.
const SWEEP_DEBOUNCE_MS: u64 = 10_000;

/// Frequencia maxima com que o laco de escrita reporta progresso. O hub ainda
/// estrangula para 1 Hz por chave; isto so evita o trabalho de sequer chamar o
/// hub a cada chunk.
const PROGRESS_SAMPLE_MS: u128 = 200;

// ---------------------------------------------------------------------------
// Maquina de estados da retoma (pura, testavel)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Resume {
    /// 206: o servidor honrou o Range, os bytes novos vao a seguir aos velhos.
    Append,
    /// 200: validador mudou (ou nao havia prefixo). DEITAR FORA o que estava.
    Truncate,
    /// 416 com um total igual ao que temos: o ficheiro ja estava completo.
    Complete,
    Error,
}

pub fn resume_action(have: u64, status: u16, content_range_total: Option<u64>) -> Resume {
    match status {
        206 => Resume::Append,
        200 => Resume::Truncate,
        416 => match content_range_total {
            // Ja temos tudo: o `.part` e o ficheiro inteiro e so falta o
            // rename. Sem isto, um ficheiro completo entrava em ciclo de erro.
            Some(total) if total == have && have > 0 => Resume::Complete,
            _ => Resume::Truncate,
        },
        _ => Resume::Error,
    }
}

/// `bytes 0-1023/2048` ou `bytes */2048` -> 2048.
fn parse_total(content_range: Option<&str>) -> Option<u64> {
    content_range?.rsplit('/').next()?.trim().parse().ok()
}

/// Content-types que aceitamos GUARDAR. Tudo o resto e descartado e a linha
/// fica sem tipo, o que faz o `protocol::content_type_for` cair no default
/// honesto por kind.
///
/// Existe porque o tipo guardado e servido de volta debaixo da origem
/// `omscache://` para sempre: um servidor que responda 200 com `text/html`
/// (uma pagina de erro de um proxy, um portal cativo) fazia o `<audio>`
/// recusar-se a descodificar um ficheiro cujos bytes podiam estar perfeitos, e
/// como a linha fica `done` nada voltava a pedi-lo. A musica ficava
/// permanentemente inaudivel offline.
fn acceptable_content_type(content_type: &str) -> bool {
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    mime.starts_with("audio/")
        || mime.starts_with("image/")
        || mime == "video/mp4"
        || mime == "application/ogg"
        || mime == "application/octet-stream"
}

fn sanitize_content_type(content_type: Option<String>) -> Option<String> {
    content_type.filter(|value| acceptable_content_type(value))
}

fn extension_for(kind: Kind, content_type: Option<&str>) -> &'static str {
    let mime = content_type.unwrap_or("").to_ascii_lowercase();
    let mime = mime.split(';').next().unwrap_or("").trim().to_string();
    match mime.as_str() {
        "audio/mp4" | "audio/x-m4a" | "audio/aac" | "video/mp4" => return "m4a",
        "audio/mpeg" | "audio/mp3" => return "mp3",
        "audio/flac" | "audio/x-flac" => return "flac",
        "audio/ogg" | "application/ogg" => return "ogg",
        "audio/opus" => return "opus",
        "audio/wav" | "audio/x-wav" => return "wav",
        "image/jpeg" => return "jpg",
        "image/png" => return "png",
        "image/webp" => return "webp",
        _ => {}
    }
    // Sem content-type util: a extensao e cosmetica (o protocolo serve pela
    // LINHA, nunca pelo nome do ficheiro), por isso um default honesto chega.
    match kind {
        Kind::Artwork => "jpg",
        Kind::Vocal | Kind::Instrumental => "mp3",
        _ => "bin",
    }
}

// ---------------------------------------------------------------------------
// Entrada na fila
// ---------------------------------------------------------------------------

pub struct EnqueueRequest {
    pub key: FileKey,
    pub media_id: String,
    pub root: Root,
    pub predicted: bool,
}

/// Apaga ficheiro + linha + memoria de estado de uma chave. Ficheiro primeiro:
/// um orfao em disco recupera-se no proximo arranque, uma linha pendurada e um
/// 404 permanente.
fn drop_entry(session: &Session, hub: &EventHub, row: &FileRow) {
    let path = session.roots.dir(row.root).join(&row.rel_path);
    let _ = std::fs::remove_file(path);
    if let Ok(db) = session.db.lock() {
        index::delete_file(&db, &row.key());
    }
    hub.forget(&row.key());
}

/// Move um ficheiro ja descarregado do root descartavel para o root pinado.
/// Acontece quando o utilizador manda descarregar uma musica que o prefetch ja
/// tinha adivinhado: os bytes ja la estao, so estavam no sitio que o macOS
/// pode purgar sem avisar.
fn promote_root(session: &Session, row: &FileRow) -> bool {
    let from = session.roots.dir(row.root).join(&row.rel_path);
    let to = session.roots.dir(Root::Pinned).join(&row.rel_path);
    // Os dois roots estao no mesmo volume (ambos debaixo do home), por isso o
    // rename e atomico; o fallback de copiar existe para quem tenha o cache
    // noutro sitio.
    let moved = std::fs::rename(&from, &to).is_ok()
        || (std::fs::copy(&from, &to).is_ok() && std::fs::remove_file(&from).is_ok());
    if moved {
        if let Ok(db) = session.db.lock() {
            let _ = index::mark_done(
                &db,
                &row.key(),
                Root::Pinned,
                &row.rel_path,
                row.content_type.as_deref(),
                row.etag.as_deref(),
                row.bytes,
            );
        }
    }
    moved
}

/// O `enqueueKind` do desktop, com a mesma reconciliacao por media id.
///
/// Os ids de media sao estaveis POR CONTEUDO (substituir um anexo cria um id
/// novo), portanto uma linha cujo `media_id` difere do que o payload actual
/// pede esta a guardar os bytes errados. Esse e o UNICO sinal de validade que
/// media precisa: bytes sao imutaveis depois de escritos, por isso nunca os
/// revalidamos por HTTP - trocamos a chave.
pub fn enqueue(
    session: &Arc<Session>,
    hub: &Arc<EventHub>,
    request: EnqueueRequest,
) -> Result<(), String> {
    if session.is_closed() {
        return Err("sessao fechada".into());
    }
    let EnqueueRequest {
        key,
        media_id,
        root,
        predicted,
    } = request;

    let existing = {
        let db = session.db.lock().map_err(|_| "indice bloqueado")?;
        index::get_file(&db, &key)
    };

    if let Some(row) = existing {
        if row.status == FileStatus::Done {
            if row.media_id != media_id {
                // Bytes velhos de um re-transcode: fora, e volta a pedir.
                drop_entry(session, hub, &row);
            } else {
                if root == Root::Pinned && row.root == Root::Evictable {
                    promote_root(session, &row);
                }
                if !predicted && row.predicted {
                    if let Ok(db) = session.db.lock() {
                        let _ = index::touch_and_promote(&db, &key.song_key);
                    }
                }
                // Ja esta em disco: nada a fazer, e o evento `done` que o JS
                // ja tem continua verdadeiro.
                return Ok(());
            }
        }
    }

    {
        let transfers = session.transfers.lock().map_err(|_| "transferencias")?;
        if transfers.contains_key(&key) {
            return Ok(());
        }
    }

    // Um pedido explicito suspende o preditivo. E a mesma regra do driver em
    // JS, repetida aqui para a invariante nao depender de o JS se portar bem:
    // deixar um want preditivo em voo enquanto uma coleccao de 250 musicas
    // drena so o poria atras de 250 itens numa fila FIFO.
    if !predicted {
        cancel_predictive(session);
    }

    {
        let db = session.db.lock().map_err(|_| "indice bloqueado")?;
        index::upsert_queued(&db, &key, &media_id, root, predicted)?;
    }
    hub.publish(&key, FileStatus::Queued, 0.0);

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut transfers = session.transfers.lock().map_err(|_| "transferencias")?;
        transfers.insert(
            key.clone(),
            Transfer {
                cancel: Arc::clone(&cancel),
                predicted,
            },
        );
    }

    let session_ref = Arc::clone(session);
    let hub_ref = Arc::clone(hub);
    tauri::async_runtime::spawn(async move {
        run(session_ref, hub_ref, key, media_id, root, predicted, cancel).await;
    });
    Ok(())
}

/// Cancela UMA `(musica, kind)`. Nunca a musica inteira: a mesma musica pode
/// ter um download explicito de outro kind a decorrer.
///
/// Duas regras que parecem detalhe e nao sao:
///
///  - uma entrada JA `done` nao e tocada. Cancelar e parar de gastar rede, nao
///    apagar bytes que ja custaram rede. Quem quer apagar chama
///    `cache_remove_song`;
///  - o `.part` NAO e apagado aqui. A tarefa que esta a escrever nele e a dona
///    do ficheiro: em Unix o unlink passaria e ela continuava a escrever para
///    um inode sem nome, e o `rename` final falhava. Quem limpa o `.part` e a
///    propria tarefa, ao ver a flag de cancelamento.
pub fn cancel(session: &Session, hub: &EventHub, key: &FileKey) {
    let flagged = {
        let Ok(mut transfers) = session.transfers.lock() else {
            return;
        };
        match transfers.remove(key) {
            Some(transfer) => {
                transfer.cancel.store(true, Ordering::SeqCst);
                true
            }
            None => false,
        }
    };

    let row = session
        .db
        .lock()
        .ok()
        .and_then(|db| index::get_file(&db, key));
    match row {
        Some(row) if row.status == FileStatus::Done => return,
        Some(row) => {
            if let Ok(db) = session.db.lock() {
                index::delete_file(&db, &row.key());
            }
        }
        None => {}
    }
    hub.forget(key);
    if !flagged {
        // Nao havia tarefa nenhuma a escrever: um `.part` que tenha sobrado de
        // uma sessao morta e lixo e sai agora.
        for root in [Root::Evictable, Root::Pinned] {
            let _ = std::fs::remove_file(session.roots.dir(root).join(key.part_filename()));
        }
    }
}

/// Apaga ficheiro, linha e memoria de estado de TODOS os kinds de uma musica.
/// E isto que o `cache_remove_song` usa; o `cancel` nao serve porque ele, de
/// proposito, nao mexe no que ja esta completo.
pub fn remove_all_kinds(session: &Session, hub: &EventHub, song_key: &str) {
    let rows = match session.db.lock() {
        Ok(db) => index::list_files(&db),
        Err(_) => return,
    };
    for row in rows.into_iter().filter(|row| row.song_key == song_key) {
        cancel(session, hub, &row.key());
        drop_entry(session, hub, &row);
        for root in [Root::Evictable, Root::Pinned] {
            let _ = std::fs::remove_file(session.roots.dir(root).join(row.key().part_filename()));
        }
    }
}

/// Cancela a (unica) transferencia preditiva em voo, se houver.
pub fn cancel_predictive(session: &Session) {
    let Ok(transfers) = session.transfers.lock() else {
        return;
    };
    for transfer in transfers.values().filter(|t| t.predicted) {
        transfer.cancel.store(true, Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------------------
// A transferencia
// ---------------------------------------------------------------------------

enum Outcome {
    Done { bytes: u64 },
    Cancelled,
    Failed(String),
}

async fn run(
    session: Arc<Session>,
    hub: Arc<EventHub>,
    key: FileKey,
    media_id: String,
    root: Root,
    predicted: bool,
    cancel: Arc<AtomicBool>,
) {
    let permit = match Arc::clone(&session.slots).acquire_owned().await {
        Ok(permit) => permit,
        Err(_) => return,
    };

    let outcome = if cancel.load(Ordering::SeqCst) || session.is_closed() {
        Outcome::Cancelled
    } else {
        transfer(&session, &hub, &key, &media_id, root, &cancel).await
    };
    drop(permit);

    if let Ok(mut transfers) = session.transfers.lock() {
        transfers.remove(&key);
    }

    match outcome {
        Outcome::Done { bytes } => {
            hub.publish(&key, FileStatus::Done, 1.0);
            if predicted {
                // Tecto de desperdicio por sessao: quando esgota, o preditivo
                // cala-se ate ao proximo arranque/login.
                session
                    .predictive_budget_left
                    .fetch_sub(bytes as i64, Ordering::Relaxed);
                schedule_sweep(&session);
            }
        }
        Outcome::Cancelled => {
            // A tarefa e a dona do `.part`, por isso e ela que o limpa - quer
            // o cancelamento tenha vindo do utilizador, quer tenha vindo da
            // suspensao do preditivo por um download explicito.
            for root in [Root::Evictable, Root::Pinned] {
                let _ = std::fs::remove_file(session.roots.dir(root).join(key.part_filename()));
            }
            if let Ok(db) = session.db.lock() {
                if index::get_file(&db, &key).is_some_and(|row| row.status != FileStatus::Done) {
                    index::delete_file(&db, &key);
                }
            }
            hub.forget(&key);
        }
        Outcome::Failed(error) => {
            if let Ok(db) = session.db.lock() {
                let _ = index::set_status(&db, &key, FileStatus::Error, Some(&error));
            }
            hub.publish(&key, FileStatus::Error, 0.0);
        }
    }
}

async fn transfer(
    session: &Arc<Session>,
    hub: &Arc<EventHub>,
    key: &FileKey,
    media_id: &str,
    root: Root,
    cancel: &Arc<AtomicBool>,
) -> Outcome {
    let dir = session.roots.dir(root).to_path_buf();
    let part = dir.join(key.part_filename());
    let stored = session
        .db
        .lock()
        .ok()
        .and_then(|db| index::get_file(&db, key));
    let stored_etag = stored.as_ref().and_then(|row| row.etag.clone());
    let stored_content_type = stored.as_ref().and_then(|row| row.content_type.clone());

    if let Ok(db) = session.db.lock() {
        let _ = index::set_status(&db, key, FileStatus::Downloading, None);
    }
    hub.publish(key, FileStatus::Downloading, 0.0);

    let mut have = tokio::fs::metadata(&part)
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    let url = session.auth_snapshot().media_url(media_id);
    let mut builder = session.http.get(&url);
    if have > 0 {
        builder = builder.header(RANGE, format!("bytes={have}-"));
        if let Some(tag) = &stored_etag {
            // If-Range e para RETOMA, nunca para validade: se o validador
            // mudou, o servidor responde 200 e nos deitamos o prefixo fora.
            builder = builder.header(IF_RANGE, tag.clone());
        }
    }

    let response = match builder.send().await {
        Ok(response) => response,
        Err(error) => return Outcome::Failed(format!("rede: {error}")),
    };

    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let content_range = headers
        .get(CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let content_length = headers
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());
    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let etag = headers
        .get(ETAG)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let action = resume_action(have, status, parse_total(content_range.as_deref()));
    let append = match action {
        Resume::Append => true,
        Resume::Truncate => {
            have = 0;
            false
        }
        Resume::Complete => {
            // Os cabecalhos de um 416 sao os cabecalhos de uma RESPOSTA DE
            // ERRO: o `Content-Type` que vem ali e `application/xml` ou
            // `text/html` (a rota de media, ou o alvo S3/MinIO onde o 302
            // aterra), nunca `audio/mp4`. Guarda-los transformava um ficheiro
            // com os bytes perfeitos numa musica que o `<audio>` se recusa a
            // descodificar para sempre, porque a linha fica `done` e nada a
            // volta a pedir. O que vale e o que a linha ja sabia da
            // transferencia anterior.
            return finish(
                session,
                key,
                root,
                &part,
                have,
                stored_content_type,
                stored_etag,
            )
            .await;
        }
        Resume::Error => return Outcome::Failed(format!("HTTP {status}")),
    };

    // Total conhecido = o que ja temos mais o que o servidor promete. Sem
    // Content-Length nao ha percentagem honesta, e uma percentagem inventada e
    // pior do que nenhuma.
    let total = content_length.map(|len| have + len);

    let file = match tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(&part)
        .await
    {
        Ok(file) => file,
        Err(error) => return Outcome::Failed(format!("disco: {error}")),
    };
    let mut writer = tokio::io::BufWriter::new(file);

    let mut written = have;
    let mut last_sample = Instant::now();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) || session.is_closed() {
            let _ = writer.flush().await;
            return Outcome::Cancelled;
        }
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(error) => return Outcome::Failed(format!("rede: {error}")),
        };
        if let Err(error) = writer.write_all(&chunk).await {
            return Outcome::Failed(format!("disco: {error}"));
        }
        written += chunk.len() as u64;

        if last_sample.elapsed().as_millis() >= PROGRESS_SAMPLE_MS {
            last_sample = Instant::now();
            if let Some(total) = total.filter(|t| *t > 0) {
                let progress = (written as f64 / total as f64).clamp(0.0, 1.0);
                if let Ok(db) = session.db.lock() {
                    index::set_progress(&db, key, progress, written as i64);
                }
                hub.publish(key, FileStatus::Downloading, progress);
            }
        }
    }

    if let Err(error) = writer.flush().await {
        return Outcome::Failed(format!("disco: {error}"));
    }
    let file = writer.into_inner();
    // fsync ANTES do rename: sem isto, um corte de energia deixa um ficheiro
    // com nome definitivo e conteudo por escrever, que e pior do que um
    // `.part` incompleto.
    if let Err(error) = file.sync_all().await {
        return Outcome::Failed(format!("fsync: {error}"));
    }
    drop(file);

    finish(session, key, root, &part, written, content_type, etag).await
}

#[allow(clippy::too_many_arguments)]
async fn finish(
    session: &Arc<Session>,
    key: &FileKey,
    root: Root,
    part: &std::path::Path,
    bytes: u64,
    content_type: Option<String>,
    etag: Option<String>,
) -> Outcome {
    // Guarda anti-veneno, espelhando o MIN_PLAUSIBLE_FILE_BYTES do movel: um
    // audio "completo" com menos de 1 KiB e um corpo de erro que o servidor
    // devolveu com 200, nao musica. Guardar isso da um ficheiro que toca
    // silencio para sempre e nunca mais e pedido outra vez.
    if key.kind.is_audio() && bytes < MIN_PLAUSIBLE_AUDIO_BYTES {
        let _ = tokio::fs::remove_file(part).await;
        return Outcome::Failed(format!("corpo implausivel ({bytes} bytes)"));
    }

    // O tipo declarado pelo servidor so e guardado se for um tipo de media: e
    // ele que o `omscache://` devolve para sempre, e um `text/html` guardado
    // aqui deixa a musica inaudivel offline sem nada que a volte a pedir.
    let content_type = sanitize_content_type(content_type);

    let filename = format!(
        "{}.{}",
        key.slug(),
        extension_for(key.kind, content_type.as_deref())
    );
    let final_path = session.roots.dir(root).join(&filename);
    if let Err(error) = tokio::fs::rename(part, &final_path).await {
        return Outcome::Failed(format!("rename: {error}"));
    }

    let Ok(db) = session.db.lock() else {
        return Outcome::Failed("indice bloqueado".into());
    };
    // SO AGORA a linha passa a done, e so depois de o ficheiro ja estar no
    // sitio definitivo.
    if let Err(error) = index::mark_done(
        &db,
        key,
        root,
        &filename,
        content_type.as_deref(),
        etag.as_deref(),
        bytes as i64,
    ) {
        return Outcome::Failed(error);
    }
    drop(db);
    Outcome::Done { bytes }
}

// ---------------------------------------------------------------------------
// Varredura adiada
// ---------------------------------------------------------------------------

/// Uma varredura armada de cada vez. Chamadas reentrantes nao acumulam
/// temporizadores - o mesmo padrao do throttle de eventos.
pub fn schedule_sweep(session: &Arc<Session>) {
    static ARMED: AtomicBool = AtomicBool::new(false);
    if ARMED.swap(true, Ordering::SeqCst) {
        return;
    }
    let session = Arc::clone(session);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(SWEEP_DEBOUNCE_MS)).await;
        ARMED.store(false, Ordering::SeqCst);
        if session.is_closed() {
            return;
        }
        let budget = session.budget_bytes.load(Ordering::Relaxed);
        let cutoff = now_ms() - EVICTABLE_TTL_MS;
        let _ = tauri::async_runtime::spawn_blocking(move || {
            evict::sweep(&session, cutoff, budget);
        })
        .await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_206_appends() {
        assert_eq!(resume_action(1_000, 206, Some(5_000)), Resume::Append);
    }

    #[test]
    fn a_200_to_a_range_request_throws_the_prefix_away() {
        // Este e o ramo que nao pode faltar: colar um corpo novo por cima de um
        // prefixo velho da um ficheiro que falha a descodificar a meio.
        assert_eq!(resume_action(1_000, 200, None), Resume::Truncate);
    }

    #[test]
    fn a_416_matching_what_we_have_means_it_was_already_complete() {
        assert_eq!(resume_action(5_000, 416, Some(5_000)), Resume::Complete);
    }

    #[test]
    fn a_416_with_a_different_total_restarts() {
        assert_eq!(resume_action(5_000, 416, Some(9_000)), Resume::Truncate);
        assert_eq!(resume_action(5_000, 416, None), Resume::Truncate);
        // Sem prefixo nenhum, um 416 nunca pode significar "completo".
        assert_eq!(resume_action(0, 416, Some(0)), Resume::Truncate);
    }

    #[test]
    fn everything_else_is_an_error() {
        assert_eq!(resume_action(0, 404, None), Resume::Error);
        assert_eq!(resume_action(0, 500, None), Resume::Error);
        assert_eq!(resume_action(0, 302, None), Resume::Error);
    }

    #[test]
    fn content_range_totals_are_parsed_from_both_shapes() {
        assert_eq!(parse_total(Some("bytes 0-1023/2048")), Some(2048));
        assert_eq!(parse_total(Some("bytes */2048")), Some(2048));
        assert_eq!(parse_total(Some("nonsense")), None);
        assert_eq!(parse_total(None), None);
    }

    #[test]
    fn extensions_follow_the_content_type_then_the_kind() {
        assert_eq!(extension_for(Kind::Mixed, Some("audio/mp4")), "m4a");
        assert_eq!(
            extension_for(Kind::Mixed, Some("audio/mpeg; charset=binary")),
            "mp3"
        );
        assert_eq!(extension_for(Kind::Artwork, Some("image/jpeg")), "jpg");
        assert_eq!(extension_for(Kind::Artwork, None), "jpg");
        assert_eq!(extension_for(Kind::Vocal, None), "mp3");
        assert_eq!(extension_for(Kind::Mixed, None), "bin");
    }
}
