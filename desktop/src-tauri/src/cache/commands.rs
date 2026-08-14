//! A superficie que o fork desktop em JS ve. Regras que valem para todas:
//!
//!  - nenhum caminho de ficheiro atravessa o IPC. O JS recebe `songKey`,
//!    `kind`, `mediaId` e bytes, e monta as URLs a partir da origem que o
//!    `cache_open` devolveu;
//!  - nao ha comando `cache_url`: o `LocalFileIndex.get` do lado JS tem de ser
//!    SINCRONO, e um `invoke` nunca e. A origem vem uma vez e o resto e
//!    concatenacao;
//!  - o estrangulamento de eventos ja aconteceu em Rust (events.rs), por isso
//!    o `cache_subscribe` entrega UM canal para tudo e o lado JS so
//!    reencaminha.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};

use super::download::{self, EnqueueRequest};
use super::events::CacheEvent;
use super::index::{self, CacheUsage, OfflinePlaylist, StoredLyrics};
use super::paths::{self, Root};
use super::{
    evict, now_ms, serve, CacheState, FileKey, FileStatus, Kind, Session, DEFAULT_BUDGET_BYTES,
    EVICTABLE_TTL_MS, SESSION_PREDICTIVE_BUDGET_BYTES, TRANSFER_CONCURRENCY,
};

const BUDGET_META_KEY: &str = "evictable_budget_bytes";
/// De quanto em quanto tempo os toques de acesso acumulados vao a disco.
const TOUCH_FLUSH_MS: u64 = 30_000;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CacheOpen {
    /// `false` em Linux (bug 146351 do WebKit). O fork JS nao se instala e a
    /// app comporta-se como a web pura.
    pub available: bool,
    pub origin: String,
    pub budget_bytes: i64,
}

/// Um pedido de bytes dentro de um download explicito.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Want {
    pub kind: Kind,
    pub media_id: String,
}

/// A linha como o JS a ve. Sem caminhos: o `LocalFileIndex` do fork desktop
/// monta `${origem}/k/${songKey}_${kind}` a partir daqui.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub song_key: String,
    pub kind: Kind,
    pub status: FileStatus,
    pub media_id: String,
    pub bytes: i64,
    pub progress: f64,
    pub predicted: bool,
    pub updated_at: i64,
}

fn session_of(state: &State<'_, CacheState>) -> Result<Arc<Session>, String> {
    state.current().ok_or_else(|| "cache fechada".to_string())
}

/// A unica janela autorizada a mexer na camada local-first.
const MAIN_WINDOW: &str = "main";

/// O guarda de janela, em CODIGO e nao num ficheiro de ACL.
///
/// A ACL das capabilities nao cobre comandos DA APP: um comando da app so e
/// verificado quando o crate traz um manifesto de permissoes proprio
/// (`src-tauri/permissions/`), e aqui nao ha nenhum - portanto as capabilities
/// nao estao a limitar nada disto, ao contrario do que a descricao do
/// `capabilities/main.json` dava a entender. Com `withGlobalTauri`, um script
/// a correr no webview do mini-player - a janela que a propria capability
/// descreve como a mais exposta e a que devia ter menos poder - podia chamar
/// `cache_set_auth` com um `api_base` a escolha (e a partir dai todas as
/// transferencias levam `?token=<bearer>` para esse host) ou `cache_purge` e
/// `cache_remove_song` para destruir a biblioteca offline.
fn guard<R: Runtime>(webview: &tauri::Webview<R>) -> Result<(), String> {
    if webview.label() == MAIN_WINDOW {
        Ok(())
    } else {
        Err("comando indisponivel nesta janela".into())
    }
}

/// O guarda dos jams, repetido aqui porque e o unico sitio do desktop onde o
/// payload da musica existe: uma proposta de jam nunca e descarregavel, e o
/// player ja a recusa a jusante. Tres guardas independentes, como no movel.
fn is_jam(song_json: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(song_json) else {
        // JSON que nao percebemos nao vai para o disco.
        return true;
    };
    let jam_flag = value
        .get("jam_song")
        .map(|v| v.as_bool().unwrap_or(!v.is_null()))
        .unwrap_or(false);
    let has_audio_url = value
        .get("audio_url")
        .map(|v| v.is_string())
        .unwrap_or(false);
    jam_flag || has_audio_url
}

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

/// Abre (ou recria) a sessao de um utilizador.
///
/// `api_base` e `token` sao parametros e nao configuracao lida de disco: o
/// Rust nunca guarda credenciais, so as tem em memoria enquanto a sessao vive.
/// (O desenho original nao os listava; sem eles o Rust nao consegue construir
/// `/media/:id/data?token=` e nao ha transferencia nenhuma.)
#[tauri::command]
#[specta::specta]
pub async fn cache_open<R: Runtime>(
    webview: tauri::Webview<R>,
    app: AppHandle<R>,
    state: State<'_, CacheState>,
    user_id: String,
    api_base: String,
    token: Option<String>,
) -> Result<CacheOpen, String> {
    guard(&webview)?;
    // Fechar a anterior antes de abrir outra: trocar de conta e close+open,
    // sem logica de purga partilhada.
    close_session(&state);

    if !serve::available() {
        // Linux v1: nem sequer abrimos indice. Dizer `available: false` e
        // parar aqui e melhor do que ter uma cache que enche o disco e cujos
        // bytes o WebKitGTK nunca consegue tocar.
        return Ok(CacheOpen {
            available: false,
            origin: serve::origin(),
            budget_bytes: 0,
        });
    }

    // O reqwest esta compilado com `rustls-no-provider` para partilhar o stack
    // de TLS do updater; o provider tem de ser instalado por alguem, e o
    // updater so o instala quando faz o primeiro pedido - que pode nunca
    // acontecer antes do primeiro download.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

    let roots = paths::roots(&app, &user_id)?;
    // POR UTILIZADOR. Um indice partilhado fazia o `startup_sweep` da conta B
    // apagar as linhas da conta A (os `rel_path` dela nao resolvem contra os
    // roots de B) e, a seguir, o `sweep_orphan_files` apagava os ficheiros de A
    // por ja nenhuma linha os reclamar - uma ida e volta entre duas contas
    // destruia a biblioteca offline da primeira.
    let index_path = paths::index_path(&app, &user_id)?;
    // Abrir a base corre migracoes e toca no disco: vai para uma thread de
    // bloqueio, nunca na thread do runtime assincrono.
    let (connection, budget) = tauri::async_runtime::spawn_blocking(move || {
        let connection = index::open(&index_path)?;
        let budget = index::meta_get(&connection, BUDGET_META_KEY)
            .and_then(|raw| raw.parse::<i64>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(DEFAULT_BUDGET_BYTES);
        Ok::<_, String>((connection, budget))
    })
    .await
    .map_err(|e| format!("abertura do indice: {e}"))??;

    // TIMEOUTS, e nao "o reqwest ja trata disso" - por omissao ele nao tem
    // nenhum. A flag de cancelamento so e lida ENTRE chunks (download.rs), por
    // isso uma ligacao que deixa de entregar bytes (portal cativo, entrada de
    // NAT que caiu, tampa do portatil fechada a meio) estacionava a tarefa
    // dentro do `stream.next()` para sempre, agarrada a um permit do semaforo.
    // Nem o `cache_cancel` nem o `cache_close` a libertavam, porque ambos so
    // levantam um atomico que ja ninguem volta a ler: tres bloqueios destes
    // esgotavam o TRANSFER_CONCURRENCY para a vida do processo e todos os
    // downloads seguintes ficavam em `queued` sem erro e sem progresso.
    //
    // Sem `timeout` global de proposito: um album de 100 MB numa ligacao lenta
    // e legitimo e demora. O que nunca e legitimo e ficar sem receber NADA.
    let http = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .read_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("cliente HTTP: {e}"))?;

    let session = Arc::new(Session {
        roots,
        db: Arc::new(Mutex::new(connection)),
        auth: Mutex::new(super::Auth { api_base, token }),
        http,
        slots: Arc::new(tokio::sync::Semaphore::new(TRANSFER_CONCURRENCY)),
        transfers: Mutex::new(HashMap::new()),
        touches: Mutex::new(HashMap::new()),
        serving: Mutex::new(HashMap::new()),
        budget_bytes: AtomicI64::new(budget),
        // Reinicia a cada abertura: e exactamente quando a aposta do prefetch
        // volta a ser boa. Nao e persistido de proposito.
        predictive_budget_left: AtomicI64::new(SESSION_PREDICTIVE_BUDGET_BYTES),
        closed: AtomicBool::new(false),
    });

    // Reconciliacao + TTL + tecto, tambem fora do runtime: sao caminhadas em
    // duas directorias e um punhado de unlinks.
    {
        let session = Arc::clone(&session);
        let cutoff = now_ms() - EVICTABLE_TTL_MS;
        tauri::async_runtime::spawn_blocking(move || {
            startup_sweep(&session);
            evict::sweep(&session, cutoff, budget);
        })
        .await
        .map_err(|e| format!("varredura de arranque: {e}"))?;
    }

    if let Ok(mut slot) = state.session.write() {
        *slot = Some(Arc::clone(&session));
    }

    spawn_touch_flusher(Arc::clone(&session));
    resume_pinned(&session, &state);

    Ok(CacheOpen {
        available: true,
        origin: serve::origin(),
        budget_bytes: budget,
    })
}

/// Quanto tempo um `.part` DESPEJAVEL por acabar sobrevive sem progredir.
///
/// Um `.part` pinado e retomado pelo `resume_pinned` a cada arranque, por isso
/// nunca fica esquecido. Um `.part` do cache de reproducao ou do tier
/// preditivo nao e retomado por ninguem: o `resume_pinned` exige linha em
/// `songs`, e `list_evictable`, `list_expired` e `usage` filtram todos por
/// `status = 'done'`. Uma transferencia dessas que morra num erro de rede ou
/// com o disco cheio deixava ate uma faixa inteira em disco que nunca contava
/// para o tecto, nunca expirava, nunca aparecia no ecra de armazenamento e
/// nunca era retomada. Um dia sem progresso chega para dizer que ninguem a vai
/// buscar.
const ORPHAN_PART_TTL_MS: i64 = 24 * 60 * 60 * 1000;

/// Reconcilia o indice com o disco. O indice e ADVISORY: linhas `done` cujo
/// ficheiro desapareceu sao apagadas, ficheiros que nenhuma linha reclama sao
/// removidos, e transferencias apanhadas a meio por um crash voltam a
/// `queued` (o `.part` fica, e e dele que a retoma parte).
fn startup_sweep(session: &Arc<Session>) {
    let Ok(db) = session.db.lock() else {
        return;
    };
    let rows = index::list_files(&db);
    let pinned = index::pinned_song_keys(&db);
    let part_cutoff = now_ms() - ORPHAN_PART_TTL_MS;
    let mut expected: HashSet<String> = HashSet::new();
    for row in &rows {
        if row.status == FileStatus::Done && !row.rel_path.is_empty() {
            let path = session.roots.dir(row.root).join(&row.rel_path);
            if path.is_file() {
                expected.insert(row.rel_path.clone());
            } else {
                index::delete_file(&db, &row.key());
            }
        } else if !pinned.contains(&row.song_key) && row.updated_at < part_cutoff {
            // Orfa e parada ha mais de um dia: ninguem a vai retomar. A linha
            // sai, e como o `.part` fica DE FORA do `expected` e o sweep de
            // orfaos logo a seguir que reclama os bytes.
            index::delete_file(&db, &row.key());
        } else {
            // Por acabar: repor em `queued` e proteger o `.part`.
            let _ = index::set_status(&db, &row.key(), FileStatus::Queued, None);
            expected.insert(row.key().part_filename());
        }
    }
    drop(db);
    paths::sweep_orphan_files(&session.roots, &expected);
}

/// Volta a meter na fila o que ficou a meio de musicas PINADAS. E isto que faz
/// "matar a app a meio de um download" retomar em vez de recomecar, sem
/// depender de o JS se lembrar de pedir.
fn resume_pinned(session: &Arc<Session>, state: &State<'_, CacheState>) {
    let rows = match session.db.lock() {
        Ok(db) => index::list_resumable(&db),
        Err(_) => return,
    };
    let hub = Arc::clone(&state.events);
    for row in rows {
        let _ = download::enqueue(
            session,
            &hub,
            EnqueueRequest {
                key: row.key(),
                media_id: row.media_id.clone(),
                root: Root::Pinned,
                predicted: false,
            },
        );
    }
}

fn spawn_touch_flusher(session: Arc<Session>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(TOUCH_FLUSH_MS)).await;
            if session.is_closed() {
                return;
            }
            session.flush_touches();
        }
    });
}

fn close_session(state: &State<'_, CacheState>) {
    let previous = match state.session.write() {
        Ok(mut slot) => slot.take(),
        Err(_) => None,
    };
    let Some(session) = previous else { return };
    session.closed.store(true, Ordering::SeqCst);
    if let Ok(transfers) = session.transfers.lock() {
        for transfer in transfers.values() {
            transfer.cancel.store(true, Ordering::SeqCst);
        }
    }
    session.flush_touches();
}

#[tauri::command]
#[specta::specta]
pub fn cache_close<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
) -> Result<(), String> {
    guard(&webview)?;
    close_session(&state);
    state.events.flush_coarse();
    state.events.clear_channel();
    Ok(())
}

/// Renova as credenciais sem fechar a sessao (rotacao de token). Sem isto, um
/// token expirado transformava todas as transferencias seguintes em erros ate
/// ao proximo login.
#[tauri::command]
#[specta::specta]
pub fn cache_set_auth<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
    api_base: String,
    token: Option<String>,
) -> Result<(), String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    if let Ok(mut auth) = session.auth.lock() {
        auth.api_base = api_base;
        auth.token = token;
    }
    Ok(())
}

/// UM canal de longa duracao para todo o estado e progresso. Chamado uma vez
/// pelo fork JS. Canal, nunca `emit`: a propria documentacao do Tauri diz que
/// o sistema de eventos nao foi desenhado para debito alto e que os canais sao
/// o que o Tauri usa internamente para progresso de downloads.
#[tauri::command]
#[specta::specta]
pub fn cache_subscribe<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
    on_event: Channel<CacheEvent>,
) -> Result<(), String> {
    guard(&webview)?;
    state.events.set_channel(on_event);
    Ok(())
}

// ---------------------------------------------------------------------------
// Transferencias
// ---------------------------------------------------------------------------

/// Download explicito: escreve a linha em `songs` (e e ESSA linha que torna a
/// musica pinada) e mete cada `(kind, media_id)` na fila.
///
/// ASSINCRONO com o corpo em `spawn_blocking`, e nao por elegancia: um comando
/// sincrono do Tauri corre na thread principal, e `collections.ts` chama isto
/// UMA VEZ POR MUSICA - sincronizar uma coleccao de 250 faz 250 invocacoes que
/// disputam `session.db` com tres transferencias vivas, tudo na thread que
/// desenha a janela. E exactamente a classe "trabalho de disco sincrono num
/// caminho quente" que as regras de 2026-08-14 proibem.
#[tauri::command]
#[specta::specta]
pub async fn cache_download<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
    song_key: String,
    song_json: String,
    wants: Vec<Want>,
) -> Result<(), String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    if is_jam(&song_json) {
        return Err("musica de jam nao e descarregavel".into());
    }
    let hub = Arc::clone(&state.events);
    tauri::async_runtime::spawn_blocking(move || {
        {
            let db = session.db.lock().map_err(|_| "indice bloqueado")?;
            index::upsert_song(&db, &song_key, &song_json)?;
        }
        for want in wants {
            if want.media_id.is_empty() {
                continue;
            }
            download::enqueue(
                &session,
                &hub,
                EnqueueRequest {
                    key: FileKey::new(song_key.clone(), want.kind),
                    media_id: want.media_id,
                    root: Root::Pinned,
                    predicted: false,
                },
            )?;
        }
        Ok::<_, String>(())
    })
    .await
    .map_err(|e| format!("cache_download: {e}"))?
}

/// O tier PREDITIVO: mesma forma orfa do cache de reproducao - linha em
/// `files`, deliberadamente SEM linha em `songs` - mas com `predicted = 1`,
/// para o despejo a levar antes de qualquer coisa que o utilizador tenha
/// ouvido mesmo.
///
/// Recusa-se sozinho em tres casos, todos baratos e locais: ha transferencias
/// explicitas em voo (o preditivo fica suspenso, nunca em fila com
/// prioridade), ja ha um palpite em voo (ha no maximo UM), ou o tecto de
/// desperdicio da sessao esgotou.
#[tauri::command]
#[specta::specta]
pub fn cache_predict<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
    song_key: String,
    media_id: String,
) -> Result<bool, String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    if media_id.is_empty() {
        return Ok(false);
    }
    if session.explicit_in_flight() > 0 || session.predictive_in_flight() > 0 {
        return Ok(false);
    }
    if session.predictive_budget_left.load(Ordering::Relaxed) <= 0 {
        return Ok(false);
    }
    {
        // Se ja conhecemos o payload desta musica e ele e de um jam, nem
        // comeca. O guarda principal e a politica do lado JS (`song.jam`);
        // este e o guarda local, e sao guardas independentes de proposito.
        let db = session.db.lock().map_err(|_| "indice bloqueado")?;
        if index::get_song_json(&db, &song_key).is_some_and(|json| is_jam(&json)) {
            return Ok(false);
        }
    }
    let hub = Arc::clone(&state.events);
    download::enqueue(
        &session,
        &hub,
        EnqueueRequest {
            key: FileKey::new(song_key, Kind::Mixed),
            media_id,
            root: Root::Evictable,
            predicted: true,
        },
    )?;
    Ok(true)
}

/// Cancelamento POR KIND, nunca por musica: a mesma musica pode ter um
/// download explicito de outro kind a decorrer.
#[tauri::command]
#[specta::specta]
pub fn cache_cancel<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
    song_key: String,
    kind: Kind,
) -> Result<(), String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    download::cancel(&session, &state.events, &FileKey::new(song_key, kind));
    Ok(())
}

/// A promocao do desktop (o `touchAndPromote` do movel). Uma linha probatoria
/// que o utilizador tocou mesmo deixa de o ser.
#[tauri::command]
#[specta::specta]
pub fn cache_promote<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
    song_key: String,
) -> Result<(), String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    let db = session.db.lock().map_err(|_| "indice bloqueado")?;
    index::touch_and_promote(&db, &song_key)
}

/// Apaga todos os kinds de uma musica e a linha de `songs`. A partir daqui a
/// musica deixa de ser pinada; se ficarem bytes, ficam como orfaos - que e o
/// tier despejavel, e o despejo trata deles.
///
/// Assincrono: percorre todas as linhas e faz um `remove_file` por kind, e
/// isso nao pode acontecer na thread da janela.
#[tauri::command]
#[specta::specta]
pub async fn cache_remove_song<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
    song_key: String,
) -> Result<(), String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    let events = Arc::clone(&state.events);
    tauri::async_runtime::spawn_blocking(move || {
        download::remove_all_kinds(&session, &events, &song_key);
        let db = session.db.lock().map_err(|_| "indice bloqueado")?;
        index::delete_song(&db, &song_key);
        Ok::<_, String>(())
    })
    .await
    .map_err(|e| format!("cache_remove_song: {e}"))?
}

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------

/// Os blobs `song_json` guardados, para os resolvers offline. Devolvidos como
/// texto: as derivacoes puras que os filtram e ordenam ja existem em
/// `src/downloads/library.ts` e nao vale a pena duplicar nenhuma em Rust.
///
/// Assincrono: desserializa a biblioteca inteira, e uma biblioteca grande e
/// muitos megabytes de texto a atravessar a thread da janela.
#[tauri::command]
#[specta::specta]
pub async fn cache_list_songs<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
) -> Result<Vec<String>, String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let db = session.db.lock().map_err(|_| "indice bloqueado")?;
        Ok::<_, String>(index::list_song_json(&db))
    })
    .await
    .map_err(|e| format!("cache_list_songs: {e}"))?
}

/// Hidrata o `LocalFileIndex` do lado JS na abertura. Assincrono: corre na
/// abertura E a cada debounce de 4 s do fork JS.
#[tauri::command]
#[specta::specta]
pub async fn cache_list_files<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
) -> Result<Vec<FileEntry>, String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let db = session.db.lock().map_err(|_| "indice bloqueado")?;
        Ok::<_, String>(
            index::list_done_files(&db)
                .into_iter()
                .map(|row| FileEntry {
                    song_key: row.song_key,
                    kind: row.kind,
                    status: row.status,
                    media_id: row.media_id,
                    bytes: row.bytes,
                    progress: row.progress,
                    predicted: row.predicted,
                    updated_at: row.updated_at,
                })
                .collect(),
        )
    })
    .await
    .map_err(|e| format!("cache_list_files: {e}"))?
}

/// Contabilidade por SUM em SQL. Nunca uma caminhada no disco: uma caminhada
/// sincrona num caminho quente e o que o relatorio de 2026-08-14 proibiu.
#[tauri::command]
#[specta::specta]
pub fn cache_usage<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
) -> Result<CacheUsage, String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    let db = session.db.lock().map_err(|_| "indice bloqueado")?;
    Ok(index::usage(&db))
}

// ---------------------------------------------------------------------------
// Coleccoes offline
// ---------------------------------------------------------------------------

#[tauri::command]
#[specta::specta]
pub fn cache_collections_list<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
) -> Result<Vec<String>, String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    let db = session.db.lock().map_err(|_| "indice bloqueado")?;
    Ok(index::list_collections(&db))
}

#[tauri::command]
#[specta::specta]
pub fn cache_collections_add<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
    key: String,
) -> Result<(), String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    let db = session.db.lock().map_err(|_| "indice bloqueado")?;
    index::add_collection(&db, &key)
}

#[tauri::command]
#[specta::specta]
pub fn cache_collections_remove<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
    key: String,
) -> Result<(), String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    let db = session.db.lock().map_err(|_| "indice bloqueado")?;
    index::remove_collection(&db, &key);
    Ok(())
}

/// Membros persistidos de uma coleccao offline. Sem isto, um arranque a frio
/// em modo de voo sabe que a playlist esta descarregada mas nao sabe QUAIS
/// musicas ela tem - foi esse o bug do lado movel na migracao 4.
#[tauri::command]
#[specta::specta]
pub fn cache_collections_set_songs<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
    key: String,
    song_keys: Vec<String>,
) -> Result<(), String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    let mut db = session.db.lock().map_err(|_| "indice bloqueado")?;
    index::set_collection_songs(&mut db, &key, &song_keys)
}

#[tauri::command]
#[specta::specta]
pub fn cache_collections_songs<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
    key: String,
) -> Result<Vec<String>, String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    let db = session.db.lock().map_err(|_| "indice bloqueado")?;
    Ok(index::list_collection_songs(&db, &key))
}

#[tauri::command]
#[specta::specta]
pub fn cache_playlists_list<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
) -> Result<Vec<OfflinePlaylist>, String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    let db = session.db.lock().map_err(|_| "indice bloqueado")?;
    Ok(index::list_offline_playlists(&db))
}

#[tauri::command]
#[specta::specta]
pub fn cache_playlists_upsert<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
    playlist: OfflinePlaylist,
) -> Result<(), String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    let db = session.db.lock().map_err(|_| "indice bloqueado")?;
    index::upsert_offline_playlist(&db, &playlist)
}

#[tauri::command]
#[specta::specta]
pub fn cache_playlists_remove<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
    id: i64,
) -> Result<(), String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    let db = session.db.lock().map_err(|_| "indice bloqueado")?;
    index::delete_offline_playlist(&db, id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Letras
// ---------------------------------------------------------------------------

#[tauri::command]
#[specta::specta]
pub fn cache_lyrics_get<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
    song_key: String,
) -> Result<Option<StoredLyrics>, String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    let db = session.db.lock().map_err(|_| "indice bloqueado")?;
    Ok(index::get_lyrics(&db, &song_key))
}

#[tauri::command]
#[specta::specta]
pub fn cache_lyrics_set<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
    song_key: String,
    lyrics_state: String,
    lyrics_json: Option<String>,
) -> Result<(), String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    let db = session.db.lock().map_err(|_| "indice bloqueado")?;
    index::set_lyrics(&db, &song_key, &lyrics_state, lyrics_json.as_deref())
}

// ---------------------------------------------------------------------------
// Definicoes
// ---------------------------------------------------------------------------

#[tauri::command]
#[specta::specta]
pub fn cache_set_budget<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
    bytes: i64,
) -> Result<(), String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    let budget = bytes.max(0);
    {
        let db = session.db.lock().map_err(|_| "indice bloqueado")?;
        index::meta_set(&db, BUDGET_META_KEY, &budget.to_string());
    }
    session.budget_bytes.store(budget, Ordering::Relaxed);
    download::schedule_sweep(&session);
    Ok(())
}

/// Esvazia o tier despejavel INTEIRO. O pinado nao e tocado: o utilizador
/// escolheu-o e limpar cache nunca deve apagar a biblioteca offline.
///
/// Assincrono: `evict::sweep` faz duas varreduras completas da tabela e um
/// numero ilimitado de `remove_file` sobre um tier de 10 GiB. Na thread da
/// janela isso era a app congelada durante todo o esvaziamento.
#[tauri::command]
#[specta::specta]
pub async fn cache_purge<R: Runtime>(
    webview: tauri::Webview<R>,
    state: State<'_, CacheState>,
) -> Result<CacheUsage, String> {
    guard(&webview)?;
    let session = session_of(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        evict::sweep(&session, now_ms(), 0);
        let db = session.db.lock().map_err(|_| "indice bloqueado")?;
        Ok::<_, String>(index::usage(&db))
    })
    .await
    .map_err(|e| format!("cache_purge: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jam_songs_are_refused_by_either_signal() {
        assert!(is_jam(r#"{"id":1,"jam_song":true}"#));
        assert!(is_jam(r#"{"id":1,"audio_url":"https://exemplo/x.mp3"}"#));
        // Um objecto de jam em vez de um booleano tambem conta.
        assert!(is_jam(r#"{"id":1,"jam_song":{"id":9}}"#));
        assert!(is_jam("nao e json"));
        assert!(!is_jam(r#"{"id":1,"jam_song":null,"audio_url":null}"#));
        assert!(!is_jam(r#"{"id":1}"#));
    }
}
