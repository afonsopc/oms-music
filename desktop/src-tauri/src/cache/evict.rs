//! Despejo por tecto de bytes, com uma ordem que e a metade barata do
//! W-TinyLFU: `predicted DESC, updated_at ASC`.
//!
//! O TTL sozinho nao e um tecto. Sete dias de prefetch agressivo enchem um
//! disco, e um LRU liso sobre os dois sub-tiers deixava uma passagem rapida
//! por uma playlist de 200 linhas despejar as musicas que o utilizador ouviu
//! mesmo. O flag `predicted` resolve isso: o que foi adivinhado morre sempre
//! primeiro, e so a reproducao a serio (`cache_promote`) o limpa.
//!
//! A decisao esta separada da execucao de proposito: `plan()` e uma funcao
//! pura sobre linhas e um tecto, testavel sem SQLite e sem disco.

use std::collections::HashSet;

use super::index::{self, FileRow};
use super::paths::Roots;
use super::{FileKey, Session};

/// Decide o que sai. Recebe os candidatos JA restritos ao tier despejavel
/// (sem linha em `songs`) e devolve, por ordem, as linhas a apagar ate o
/// total caber no tecto.
///
/// `keep` sao chaves que estao a ser servidas neste instante: em macOS e Linux
/// um fd aberto sobrevive ao unlink, mas o PROXIMO pedido de range abre por
/// caminho e apanhava 404 a meio de um seek.
pub fn plan(candidates: &[FileRow], budget_bytes: i64, keep: &HashSet<FileKey>) -> Vec<FileRow> {
    let mut ordered: Vec<&FileRow> = candidates.iter().collect();
    // A SQL ja devolve por esta ordem; reordenar aqui e o que torna a funcao
    // verdadeira por si so, sem depender do ORDER BY de quem chama.
    ordered.sort_by(|a, b| {
        b.predicted
            .cmp(&a.predicted)
            .then(a.updated_at.cmp(&b.updated_at))
    });

    let mut total: i64 = candidates.iter().map(|row| row.bytes).sum();
    let mut victims = Vec::new();
    for row in ordered {
        if total <= budget_bytes {
            break;
        }
        if keep.contains(&row.key()) {
            continue;
        }
        total -= row.bytes;
        victims.push(row.clone());
    }
    victims
}

/// Apaga o ficheiro e SO DEPOIS a linha. Um ficheiro orfao recupera-se (o
/// sweep do arranque limpa-o); uma linha pendurada sem ficheiro e um 404
/// permanente para o player.
fn drop_row(session: &Session, roots: &Roots, row: &FileRow) -> i64 {
    let path = roots.dir(row.root).join(&row.rel_path);
    let _ = std::fs::remove_file(path);
    if let Ok(db) = session.db.lock() {
        index::delete_file(&db, &row.key());
    }
    row.bytes
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SweepReport {
    pub expired: usize,
    pub evicted: usize,
    /// Bytes preditivos que morreram sem nunca terem sido tocados. E o
    /// numerador da metrica de desperdicio; sem ela nao ha maneira de afinar
    /// a escada de palpites.
    pub predicted_unplayed_bytes: i64,
}

/// TTL + tecto, por esta ordem. Corre no arranque e, com atraso, depois de
/// cada transferencia que aterre uma linha orfa.
pub fn sweep(session: &Session, ttl_cutoff: i64, budget_bytes: i64) -> SweepReport {
    let mut report = SweepReport::default();

    let expired = match session.db.lock() {
        Ok(db) => index::list_expired(&db, ttl_cutoff),
        Err(_) => return report,
    };
    let serving: HashSet<FileKey> = session
        .serving
        .lock()
        .map(|s| s.keys().cloned().collect())
        .unwrap_or_default();

    for row in expired {
        if serving.contains(&row.key()) {
            continue;
        }
        if row.predicted {
            report.predicted_unplayed_bytes += row.bytes;
        }
        drop_row(session, &session.roots, &row);
        report.expired += 1;
    }

    let (candidates, partial_bytes) = match session.db.lock() {
        Ok(db) => (
            index::list_evictable(&db),
            index::evictable_partial_bytes(&db),
        ),
        Err(_) => return report,
    };
    // Os `.part` orfaos ocupam disco e nao sao candidatos (nao ha ficheiro
    // final para apagar), por isso o tecto que sobra para as linhas `done` e o
    // tecto menos o que eles ja gastaram. Sem esta subtraccao a contabilidade
    // mentia por baixo, exactamente na direccao que enche o disco.
    let budget_bytes = (budget_bytes - partial_bytes).max(0);
    for row in plan(&candidates, budget_bytes, &serving) {
        if row.predicted {
            report.predicted_unplayed_bytes += row.bytes;
        }
        drop_row(session, &session.roots, &row);
        report.evicted += 1;
    }

    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::paths::Root;
    use crate::cache::{FileStatus, Kind};

    fn row(song_key: &str, predicted: bool, updated_at: i64, bytes: i64) -> FileRow {
        FileRow {
            song_key: song_key.to_string(),
            kind: Kind::Mixed,
            status: FileStatus::Done,
            media_id: "1".into(),
            root: Root::Evictable,
            rel_path: format!("{song_key}_mixed.m4a"),
            content_type: None,
            etag: None,
            bytes,
            progress: 1.0,
            predicted,
            updated_at,
        }
    }

    #[test]
    fn nothing_is_evicted_while_the_budget_fits() {
        let rows = vec![row("1", true, 1, 100), row("2", false, 2, 100)];
        assert!(plan(&rows, 1_000, &HashSet::new()).is_empty());
    }

    #[test]
    fn probationary_rows_go_first_regardless_of_recency() {
        // O probatorio e o MAIS RECENTE de todos e mesmo assim sai primeiro.
        let rows = vec![
            row("velho", false, 1, 100),
            row("novo", false, 500, 100),
            row("adivinhado", true, 9_999, 100),
        ];
        let victims = plan(&rows, 250, &HashSet::new());
        assert_eq!(victims.len(), 1);
        assert_eq!(victims[0].song_key, "adivinhado");
    }

    #[test]
    fn within_a_tier_it_is_plain_lru() {
        let rows = vec![
            row("velho", false, 1, 100),
            row("medio", false, 50, 100),
            row("novo", false, 500, 100),
        ];
        let victims = plan(&rows, 150, &HashSet::new());
        let keys: Vec<&str> = victims.iter().map(|r| r.song_key.as_str()).collect();
        assert_eq!(keys, vec!["velho", "medio"]);
    }

    #[test]
    fn the_sweep_stops_the_moment_the_budget_fits() {
        let rows = vec![
            row("a", false, 1, 100),
            row("b", false, 2, 100),
            row("c", false, 3, 100),
        ];
        // 300 no total, tecto 200: sai exactamente um.
        assert_eq!(plan(&rows, 200, &HashSet::new()).len(), 1);
    }

    #[test]
    fn a_file_being_served_is_never_evicted() {
        let rows = vec![row("a", true, 1, 100), row("b", true, 2, 100)];
        let mut keep = HashSet::new();
        keep.insert(FileKey::new("a", Kind::Mixed));
        let victims = plan(&rows, 0, &keep);
        let keys: Vec<&str> = victims.iter().map(|r| r.song_key.as_str()).collect();
        assert_eq!(keys, vec!["b"]);
    }

    #[test]
    fn a_budget_of_zero_still_never_touches_pinned_rows() {
        // Linhas pinadas nunca chegam a `plan`: a SQL de candidatos exclui-as.
        // O que este teste fixa e que um tecto de zero esvazia o tier
        // despejavel INTEIRO e nada mais.
        let rows = vec![row("a", false, 1, 100), row("b", false, 2, 100)];
        assert_eq!(plan(&rows, 0, &HashSet::new()).len(), 2);
    }
}
