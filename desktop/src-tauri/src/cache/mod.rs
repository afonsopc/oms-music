//! Camada local-first do shell desktop: o equivalente Rust do `src/downloads/`
//! movel, com o MESMO vocabulario de proposito.
//!
//! Uma entrada de cache e `(song_key, kind)` e traz sempre o `media_id` de
//! onde veio. Ha dois tiers, e ser "pinado" e DERIVADO, nunca guardado duas
//! vezes:
//!
//!  - **PINADO** = existe linha em `songs`. Nunca e despejado nem expira.
//!  - **DESPEJAVEL** = linha orfa, sem `songs`. Divide-se em duas por causa da
//!    coluna `predicted`: `0` = tocado (o utilizador ouviu mesmo), `1` =
//!    probatorio (veio do prefetch preditivo e pode nunca ser ouvido).
//!
//! O despejo ordena por `predicted DESC, updated_at ASC`, portanto o que o
//! prefetch adivinhou morre SEMPRE antes do que o utilizador ouviu. Essa e a
//! metade barata do W-TinyLFU e e o que torna seguro adivinhar com vontade.
//!
//! Fronteiras que este modulo nao atravessa:
//!  - nenhum caminho de ficheiro cruza o IPC, em nenhum sentido. O JS recebe
//!    URLs `omscache://` e mais nada;
//!  - o webview nao ganha permissao `fs:`, `sql:` nem `http:`. O cliente HTTP
//!    e do Rust, o disco e do Rust, a base de dados e do Rust;
//!  - a disciplina de eventos (grosso so em transicoes, progresso a 1 Hz) e
//!    aplicada EM RUST, antes de o evento sair, para o lado JS ser um
//!    reencaminhador burro que nao consegue errar.

pub mod commands;
pub mod download;
pub mod events;
pub mod evict;
pub mod index;
pub mod paths;
pub mod protocol;
pub mod serve;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicI64};
use std::sync::{Arc, Mutex, RwLock};

use rusqlite::Connection;

/// Esquema do protocolo de media. Vive aqui porque o lib.rs o regista e o
/// serve.rs constroi a origem a partir dele - uma so verdade.
pub const SCHEME: &str = "omscache";

/// Tecto do tier despejavel no desktop. Fixo, e nao uma fraccao do espaco
/// livre como no movel, porque a std nao tem statvfs e este desenho recusa-se
/// a acrescentar um crate so para ler espaco em disco. 10 GiB e generoso o
/// suficiente para nunca incomodar e pequeno o suficiente para nunca encher
/// um portatil sozinho.
pub const DEFAULT_BUDGET_BYTES: i64 = 10 * 1024 * 1024 * 1024;

/// Tecto de desperdicio POR SESSAO do tier preditivo. Nao e persistido de
/// proposito: reinicia a cada arranque/login, que e exactamente quando a
/// aposta do prefetch volta a ser boa.
pub const SESSION_PREDICTIVE_BUDGET_BYTES: i64 = 2 * 1024 * 1024 * 1024;

/// TTL do tier despejavel, medido sobre `updated_at` (que o toque do
/// protocolo mantem fresco). Igual ao movel.
pub const EVICTABLE_TTL_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// Concorrencia de transferencias. 3, igual ao TRANSFER_CONCURRENCY do movel,
/// para as duas plataformas se comportarem da mesma maneira debaixo de uma
/// sincronizacao grande. NAO ha slot dedicado ao preditivo: o preditivo fica
/// suspenso enquanto houver transferencias explicitas, que e mais simples e
/// nao introduz fila com prioridades.
pub const TRANSFER_CONCURRENCY: usize = 3;

/// Abaixo disto, um audio "completo" e um corpo de erro, nao media. Espelha o
/// MIN_PLAUSIBLE_FILE_BYTES do movel.
pub const MIN_PLAUSIBLE_AUDIO_BYTES: u64 = 1024;

// ---------------------------------------------------------------------------
// Vocabulario
// ---------------------------------------------------------------------------

/// As cinco especies de bytes por musica. Mesmos nomes que o DownloadKind do
/// movel, porque as duas metades da app falam a mesma lingua.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Mixed,
    MixedOriginal,
    Artwork,
    Vocal,
    Instrumental,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Mixed => "mixed",
            Kind::MixedOriginal => "mixed_original",
            Kind::Artwork => "artwork",
            Kind::Vocal => "vocal",
            Kind::Instrumental => "instrumental",
        }
    }

    pub fn parse(raw: &str) -> Option<Kind> {
        match raw {
            "mixed" => Some(Kind::Mixed),
            "mixed_original" => Some(Kind::MixedOriginal),
            "artwork" => Some(Kind::Artwork),
            "vocal" => Some(Kind::Vocal),
            "instrumental" => Some(Kind::Instrumental),
            _ => None,
        }
    }

    /// Artwork e servida inteira; audio e servido as fatias. Ver protocol.rs.
    pub fn is_audio(self) -> bool {
        !matches!(self, Kind::Artwork)
    }
}

impl fmt::Display for Kind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Estados de uma linha de `files`. Mesmos quatro do movel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Queued,
    Downloading,
    Done,
    Error,
}

impl FileStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            FileStatus::Queued => "queued",
            FileStatus::Downloading => "downloading",
            FileStatus::Done => "done",
            FileStatus::Error => "error",
        }
    }

    pub fn parse(raw: &str) -> Option<FileStatus> {
        match raw {
            "queued" => Some(FileStatus::Queued),
            "downloading" => Some(FileStatus::Downloading),
            "done" => Some(FileStatus::Done),
            "error" => Some(FileStatus::Error),
            _ => None,
        }
    }
}

/// Chave de uma entrada. `song_key` e a representacao de armazenamento da app
/// (id decimal em texto), exactamente como no movel.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct FileKey {
    pub song_key: String,
    pub kind: Kind,
}

impl FileKey {
    pub fn new(song_key: impl Into<String>, kind: Kind) -> FileKey {
        FileKey {
            song_key: song_key.into(),
            kind,
        }
    }

    /// A forma que o protocolo usa no caminho `/k/<chave>` e que da nome ao
    /// ficheiro em disco. `song_key` e so digitos, por isso partir no PRIMEIRO
    /// `_` e sempre correcto, mesmo com `mixed_original` do outro lado.
    pub fn slug(&self) -> String {
        format!("{}_{}", self.song_key, self.kind.as_str())
    }

    pub fn part_filename(&self) -> String {
        format!("{}.part", self.slug())
    }
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Estado gerido
// ---------------------------------------------------------------------------

/// Credenciais para falar com o backend. Sao passadas pelo JS no `cache_open`
/// e renovadas por `cache_set_auth` quando o token roda - o Rust nunca as le
/// de disco nem as persiste.
#[derive(Debug, Clone, Default)]
pub struct Auth {
    pub api_base: String,
    pub token: Option<String>,
}

impl Auth {
    /// `/media/:id/data?token=` - a rota que segue 302 e esta ISENTA do
    /// rate-limit. E a mesma que o movel usa para todas as imagens e
    /// downloads; a resolucao presignada (`data_url`) conta para o tecto de
    /// 600/min e nao entra aqui.
    pub fn media_url(&self, media_id: &str) -> String {
        let base = format!(
            "{}/media/{}/data",
            self.api_base.trim_end_matches('/'),
            media_id
        );
        match &self.token {
            Some(token) if !token.is_empty() => {
                format!(
                    "{base}?token={}",
                    percent_encoding::utf8_percent_encode(
                        token,
                        percent_encoding::NON_ALPHANUMERIC
                    )
                )
            }
            _ => base,
        }
    }
}

/// Uma transferencia em voo. O cancelamento e uma flag atomica lida dentro do
/// laco de streaming (e nao um abort do handle) para o `.part` ficar sempre
/// num estado coerente: quem cancela quer parar de gastar rede, nao corromper
/// o que ja esta escrito.
pub struct Transfer {
    pub cancel: Arc<AtomicBool>,
    pub predicted: bool,
}

/// Uma sessao = um utilizador. Trocar de conta e close + open, sem logica de
/// purga partilhada, exactamente como no movel.
pub struct Session {
    pub roots: paths::Roots,
    /// UMA ligacao atras de um Mutex. O trabalho e um punhado de statements
    /// por transferencia; um pool nao compra nada e custa threads do SO.
    pub db: Arc<Mutex<Connection>>,
    pub auth: Mutex<Auth>,
    pub http: reqwest::Client,
    pub slots: Arc<tokio::sync::Semaphore>,
    pub transfers: Mutex<HashMap<FileKey, Transfer>>,
    /// Toques de acesso adiados. Uma faixa de cinco minutos gera dezenas de
    /// pedidos de range; um UPDATE por pedido era uma tempestade de escritas.
    /// Isto acumula e e despejado de 30 em 30 segundos e ao fechar.
    pub touches: Mutex<HashMap<FileKey, i64>>,
    /// Contagem de servicos em voo por chave. Em macOS e Linux um fd aberto
    /// continua a funcionar depois do unlink, mas o PROXIMO pedido de range
    /// abre por caminho e apanhava 404 - por isso o despejo salta ficheiros
    /// que estao a ser servidos neste instante.
    pub serving: Mutex<HashMap<FileKey, u32>>,
    pub budget_bytes: AtomicI64,
    pub predictive_budget_left: AtomicI64,
    pub closed: AtomicBool,
}

#[derive(Default)]
pub struct CacheState {
    pub session: RwLock<Option<Arc<Session>>>,
    pub events: Arc<events::EventHub>,
}

impl CacheState {
    pub fn current(&self) -> Option<Arc<Session>> {
        self.session.read().ok().and_then(|g| g.clone())
    }
}

impl Session {
    pub fn auth_snapshot(&self) -> Auth {
        self.auth.lock().map(|a| a.clone()).unwrap_or_default()
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Quantas transferencias EXPLICITAS estao em voo. O preditivo fica
    /// suspenso enquanto isto for maior que zero: deixar um want preditivo
    /// entrar enquanto uma coleccao de 250 musicas drena so o punha atras de
    /// 250 itens na fila FIFO.
    pub fn explicit_in_flight(&self) -> usize {
        self.transfers
            .lock()
            .map(|t| t.values().filter(|t| !t.predicted).count())
            .unwrap_or(0)
    }

    pub fn predictive_in_flight(&self) -> usize {
        self.transfers
            .lock()
            .map(|t| t.values().filter(|t| t.predicted).count())
            .unwrap_or(0)
    }

    pub fn note_touch(&self, key: FileKey) {
        if let Ok(mut touches) = self.touches.lock() {
            touches.insert(key, now_ms());
        }
    }

    /// Escreve os toques acumulados. Chamado pelo temporizador de 30s e no
    /// `cache_close`.
    pub fn flush_touches(&self) {
        let drained: Vec<(FileKey, i64)> = match self.touches.lock() {
            Ok(mut touches) => touches.drain().collect(),
            Err(_) => return,
        };
        if drained.is_empty() {
            return;
        }
        if let Ok(db) = self.db.lock() {
            for (key, at) in drained {
                let _ = index::touch_file(&db, &key, at);
            }
        }
    }

    pub fn serving_begin(&self, key: &FileKey) {
        if let Ok(mut serving) = self.serving.lock() {
            *serving.entry(key.clone()).or_insert(0) += 1;
        }
    }

    pub fn serving_end(&self, key: &FileKey) {
        if let Ok(mut serving) = self.serving.lock() {
            if let Some(count) = serving.get_mut(key) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    serving.remove(key);
                }
            }
        }
    }
}
