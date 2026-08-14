//! Os dois canais de estado, com a divisao feita EM RUST.
//!
//! A regra e literalmente a de `src/downloads/status.ts`, e nao uma
//! reinterpretacao dela:
//!
//!  - o canal GROSSO bate SO em transicoes de estado
//!    (none -> queued -> downloading -> done/error);
//!  - uma amostra de progresso com o MESMO estado vai para o canal de
//!    progresso, no maximo uma por segundo e por chave;
//!  - as emissoes grossas ainda coalescem numa janela de 250 ms, ficando a
//!    ultima por chave.
//!
//! Porque e que isto vive aqui e nao no lado JS: com tres transferencias em
//! paralelo a debitar chunks, uma emissao por chunk atravessava o IPC as
//! centenas por segundo. A propria documentacao do Tauri diz que o sistema de
//! eventos "nao foi desenhado para baixa latencia nem para debito alto" e que
//! os canais sao o que o Tauri usa internamente para progresso de downloads -
//! por isso e `Channel`, nunca `emit`. Fazendo a divisao aqui, o lado JS fica
//! um reencaminhador burro que nao TEM COMO errar a disciplina, e foi errar a
//! disciplina que congelou a app a 2026-08-14.
//!
//! Perder transicoes intermedias dentro da janela de 250 ms e igual ao movel:
//! la o canal grosso nem sequer transporta qual e o estado - quem ouve vai ler
//! o mapa no fim da janela -, portanto um queued->downloading->done rapido
//! tambem so se ve uma vez.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::ipc::Channel;

use super::{FileKey, FileStatus, Kind};

pub const COARSE_WINDOW_MS: u64 = 250;
pub const PROGRESS_INTERVAL_MS: u128 = 1_000;

/// O que atravessa o IPC. Duas variantes e mais nada: acrescentar uma terceira
/// obrigaria o lado JS a decidir alguma coisa, e ele nao deve decidir nada.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CacheEvent {
    /// Emitido SO numa transicao de estado. Espelha o notifyCoarse do
    /// status.ts.
    #[serde(rename_all = "camelCase")]
    Status {
        song_key: String,
        kind: Kind,
        status: FileStatus,
        progress: f64,
    },
    /// No maximo um por segundo POR (musica, kind) enquanto os bytes andam.
    #[serde(rename_all = "camelCase")]
    Progress {
        song_key: String,
        kind: Kind,
        progress: f64,
    },
}

/// A decisao, isolada da entrega para poder ser testada sem canal nenhum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Emit {
    /// Transicao: vai para a fila grossa (janela de 250 ms).
    Coarse,
    /// Mesma etiqueta, bytes a mexer: canal de progresso.
    Progress,
    /// Mesma etiqueta, dentro do segundo: nao sai nada.
    Drop,
}

pub fn decide(
    previous: Option<FileStatus>,
    next: FileStatus,
    since_last_progress_ms: u128,
) -> Emit {
    match previous {
        Some(prev) if prev == next => {
            if since_last_progress_ms >= PROGRESS_INTERVAL_MS {
                Emit::Progress
            } else {
                Emit::Drop
            }
        }
        _ => Emit::Coarse,
    }
}

struct Entry {
    status: FileStatus,
    last_progress: Instant,
}

#[derive(Default)]
pub struct EventHub {
    channel: Mutex<Option<Channel<CacheEvent>>>,
    entries: Mutex<HashMap<FileKey, Entry>>,
    /// Transicoes a espera do fim da janela. Ultima por chave ganha.
    pending: Mutex<HashMap<FileKey, (FileStatus, f64)>>,
    armed: AtomicBool,
}

impl EventHub {
    pub fn set_channel(&self, channel: Channel<CacheEvent>) {
        if let Ok(mut slot) = self.channel.lock() {
            *slot = Some(channel);
        }
    }

    pub fn clear_channel(&self) {
        if let Ok(mut slot) = self.channel.lock() {
            *slot = None;
        }
        if let Ok(mut entries) = self.entries.lock() {
            entries.clear();
        }
        if let Ok(mut pending) = self.pending.lock() {
            pending.clear();
        }
    }

    /// Esquece o que sabia sobre uma chave. Chamado quando a linha e apagada
    /// (cancelamento, remocao, despejo), para um download futuro da mesma
    /// chave voltar a contar como transicao e nao como "ja estava assim".
    pub fn forget(&self, key: &FileKey) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(key);
        }
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(key);
        }
    }

    fn send(&self, event: CacheEvent) {
        if let Ok(slot) = self.channel.lock() {
            if let Some(channel) = slot.as_ref() {
                // Um canal fechado (janela a ir abaixo) nao e um erro da
                // transferencia; a transferencia continua e o indice fica
                // certo na mesma.
                let _ = channel.send(event);
            }
        }
    }

    /// Ponto de entrada unico das transferencias. Devolve o que decidiu, para
    /// os testes poderem observar sem canal.
    pub fn publish(self: &Arc<Self>, key: &FileKey, status: FileStatus, progress: f64) -> Emit {
        let now = Instant::now();
        let decision = {
            let Ok(mut entries) = self.entries.lock() else {
                return Emit::Drop;
            };
            let previous = entries.get(key).map(|e| e.status);
            let elapsed = entries
                .get(key)
                .map(|e| now.duration_since(e.last_progress).as_millis())
                .unwrap_or(u128::MAX);
            let decision = decide(previous, status, elapsed);
            match decision {
                Emit::Coarse => {
                    entries.insert(
                        key.clone(),
                        Entry {
                            status,
                            // A transicao conta como marco de progresso: senao
                            // um `downloading` seguido de uma amostra 10 ms
                            // depois emitia duas coisas seguidas.
                            last_progress: now,
                        },
                    );
                }
                Emit::Progress => {
                    if let Some(entry) = entries.get_mut(key) {
                        entry.last_progress = now;
                    }
                }
                Emit::Drop => {}
            }
            decision
        };

        match decision {
            Emit::Coarse => self.queue_coarse(key.clone(), status, progress),
            Emit::Progress => self.send(CacheEvent::Progress {
                song_key: key.song_key.clone(),
                kind: key.kind,
                progress,
            }),
            Emit::Drop => {}
        }
        decision
    }

    fn queue_coarse(self: &Arc<Self>, key: FileKey, status: FileStatus, progress: f64) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(key, (status, progress));
        }
        // Uma so espera armada de cada vez, exactamente como o throttleTimer do
        // status.ts. Chamadas reentrantes nao acumulam temporizadores.
        if self.armed.swap(true, Ordering::SeqCst) {
            return;
        }
        let hub = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(COARSE_WINDOW_MS)).await;
            hub.armed.store(false, Ordering::SeqCst);
            hub.flush_coarse();
        });
    }

    pub fn flush_coarse(&self) {
        let drained: Vec<(FileKey, (FileStatus, f64))> = match self.pending.lock() {
            Ok(mut pending) => pending.drain().collect(),
            Err(_) => return,
        };
        for (key, (status, progress)) in drained {
            self.send(CacheEvent::Status {
                song_key: key.song_key,
                kind: key.kind,
                status,
                progress,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_status_change_always_emits_coarse() {
        assert_eq!(decide(None, FileStatus::Queued, 0), Emit::Coarse);
        assert_eq!(
            decide(Some(FileStatus::Queued), FileStatus::Downloading, 0),
            Emit::Coarse
        );
        assert_eq!(
            decide(Some(FileStatus::Downloading), FileStatus::Done, 0),
            Emit::Coarse
        );
    }

    #[test]
    fn a_hundred_samples_in_one_second_emit_exactly_one_progress() {
        // Uma transicao (o primeiro `downloading`) e depois 100 amostras
        // espalhadas por menos de um segundo. So a que cruza o segundo sai.
        let mut emitted = 0;
        let mut elapsed: u128 = 0;
        for _ in 0..100 {
            elapsed += 10; // ~10 ms entre amostras
            let decision = decide(Some(FileStatus::Downloading), FileStatus::Downloading, elapsed);
            if decision == Emit::Progress {
                emitted += 1;
                elapsed = 0;
            }
        }
        assert_eq!(emitted, 1);
    }

    #[test]
    fn the_hub_only_bumps_coarse_on_transitions() {
        let hub = Arc::new(EventHub::default());
        let key = FileKey::new("1", Kind::Mixed);
        assert_eq!(hub.publish(&key, FileStatus::Queued, 0.0), Emit::Coarse);
        assert_eq!(
            hub.publish(&key, FileStatus::Downloading, 0.0),
            Emit::Coarse
        );
        // Amostra logo a seguir, mesmo estado: nao sai nada, nem grosso nem
        // progresso.
        assert_eq!(hub.publish(&key, FileStatus::Downloading, 0.1), Emit::Drop);
        assert_eq!(hub.publish(&key, FileStatus::Done, 1.0), Emit::Coarse);
    }

    #[test]
    fn forgetting_a_key_makes_the_next_write_a_transition_again() {
        let hub = Arc::new(EventHub::default());
        let key = FileKey::new("1", Kind::Mixed);
        hub.publish(&key, FileStatus::Done, 1.0);
        assert_eq!(hub.publish(&key, FileStatus::Done, 1.0), Emit::Drop);
        hub.forget(&key);
        assert_eq!(hub.publish(&key, FileStatus::Done, 1.0), Emit::Coarse);
    }
}
