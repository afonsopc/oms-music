//! Onde os bytes vivem, e porque vivem em dois sitios diferentes.
//!
//! ```text
//! app_data_dir()/media/<user_id>/               ROOT_PINNED     (sobrevive, e copiado)
//! app_cache_dir()/media/<user_id>/              ROOT_EVICTABLE  (o macOS purga sob pressao)
//! app_data_dir()/media/<user_id>/index.sqlite   o indice (+ -wal, -shm)
//! ```
//!
//! O indice vive DENTRO da directoria do utilizador, e isso e um requisito de
//! correccao, nao arrumacao. Com um indice partilhado por todas as contas, o
//! `startup_sweep` da conta B resolvia as linhas da conta A contra os roots de
//! B, nao encontrava ficheiro nenhum e apagava-as; a seguir o
//! `sweep_orphan_files` corria e, como ja nenhuma linha reclamava os ficheiros
//! de A, apagava-os do disco. Uma ida e volta entre duas contas na mesma
//! maquina limpava a biblioteca offline da primeira. E, antes disso, as
//! tabelas `songs`, `collections` e `offline_playlists` tambem nao eram
//! filtradas por utilizador, portanto o `cache_list_songs` da conta B mostrava
//! os titulos e as playlists que a conta A tinha descarregado.
//!
//! Duas decisoes que parecem detalhe e nao sao:
//!
//! 1. **Conteudo pinado NUNCA vive debaixo do app_cache_dir.** O macOS apaga
//!    essa arvore num evento de disco cheio, sem avisar ninguem: a biblioteca
//!    offline do utilizador desaparecia em silencio e o proximo arranque sem
//!    rede parecia um bug nosso. O que e descartavel (o cache de reproducao e
//!    o preditivo) e que vive la, porque para esse a purga do sistema e
//!    exactamente a politica que queriamos.
//! 2. **O indice vive no dir de DADOS**, mesmo descrevendo sobretudo ficheiros
//!    do dir de cache. Perder o `-wal` e manter o `.sqlite` e uma classe de
//!    corrupcao que nos recusamos a possuir. A consequencia assumida e que o
//!    indice e ADVISORY, nao autoritativo: quem serve faz sempre `stat` ao
//!    ficheiro, e o `startup_sweep` reconcilia os dois lados no arranque.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

/// Sub-arvore comum aos dois roots, para o sweep nunca tocar em nada que nao
/// seja nosso dentro do app_data_dir/app_cache_dir.
const MEDIA_DIR: &str = "media";
const INDEX_FILE: &str = "index.sqlite";

/// Qual dos dois roots. Guardado como inteiro na coluna `root` da tabela
/// `files`, e nunca um caminho absoluto: mudar o bundle identifier, o nome do
/// utilizador do sistema ou a versao do macOS muda o prefixo, e um caminho
/// absoluto persistido transformava isso numa biblioteca inteira "perdida".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Root {
    /// app_cache_dir: cache de reproducao + tier preditivo.
    Evictable = 0,
    /// app_data_dir: downloads explicitos do utilizador.
    Pinned = 1,
}

impl Root {
    pub fn as_i64(self) -> i64 {
        self as i64
    }

    /// Qualquer valor desconhecido cai em Evictable: se o indice trouxer lixo,
    /// o pior que acontece e o ficheiro ser elegivel para despejo, nunca ser
    /// servido a partir de um sitio errado.
    pub fn from_i64(value: i64) -> Root {
        if value == 1 {
            Root::Pinned
        } else {
            Root::Evictable
        }
    }
}

#[derive(Debug, Clone)]
pub struct Roots {
    pub pinned: PathBuf,
    pub evictable: PathBuf,
}

impl Roots {
    pub fn dir(&self, root: Root) -> &Path {
        match root {
            Root::Pinned => &self.pinned,
            Root::Evictable => &self.evictable,
        }
    }
}

/// O id de utilizador entra no caminho, por isso e validado como se viesse de
/// fora (e, no limite, vem: e o JS que o passa). So digitos, letras, hifen e
/// underscore; qualquer outra coisa nao chega a virar directoria.
pub fn sanitize_user(user_id: &str) -> Option<String> {
    if user_id.is_empty() || user_id.len() > 64 {
        return None;
    }
    if user_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        Some(user_id.to_string())
    } else {
        None
    }
}

/// O indice DESTE utilizador. Fica ao lado dos ficheiros pinados dele, no dir
/// de DADOS: perder o `-wal` e manter o `.sqlite` e uma classe de corrupcao que
/// nos recusamos a possuir, e por isso ele nunca vive no dir de cache mesmo
/// descrevendo sobretudo ficheiros de la.
///
/// O `sweep_orphan_files` conhece este nome e nunca o apaga (ver `EXTRAS`).
pub fn index_path<R: Runtime>(app: &AppHandle<R>, user_id: &str) -> Result<PathBuf, String> {
    let user = sanitize_user(user_id).ok_or_else(|| "user_id invalido".to_string())?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir indisponivel: {e}"))?
        .join(MEDIA_DIR)
        .join(&user);
    std::fs::create_dir_all(&dir).map_err(|e| format!("nao consegui criar {dir:?}: {e}"))?;
    Ok(dir.join(INDEX_FILE))
}

pub fn roots<R: Runtime>(app: &AppHandle<R>, user_id: &str) -> Result<Roots, String> {
    let user = sanitize_user(user_id).ok_or_else(|| "user_id invalido".to_string())?;
    let pinned = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir indisponivel: {e}"))?
        .join(MEDIA_DIR)
        .join(&user);
    let evictable = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("app_cache_dir indisponivel: {e}"))?
        .join(MEDIA_DIR)
        .join(&user);
    std::fs::create_dir_all(&pinned).map_err(|e| format!("nao consegui criar {pinned:?}: {e}"))?;
    std::fs::create_dir_all(&evictable)
        .map_err(|e| format!("nao consegui criar {evictable:?}: {e}"))?;
    Ok(Roots { pinned, evictable })
}

/// Junta root + rel_path e CANONICALIZA, exigindo que o resultado continue
/// debaixo do root. O `starts_with` sobre o caminho por resolver nao chega: um
/// symlink plantado dentro da pasta de cache aponta para fora sem nunca
/// escrever `..` no caminho. E o canonicalize que apanha isso, e e por isso
/// que ele existe aqui e nao no parser.
pub fn resolve_within(root: &Path, rel_path: &str) -> Option<PathBuf> {
    // Um rel_path absoluto ou com componentes de subida nao e um erro de
    // programacao a corrigir mais tarde: e o unico caminho pelo qual o indice
    // poderia mandar servir /etc/passwd. Morre aqui.
    let candidate = Path::new(rel_path);
    if candidate.is_absolute() || candidate.components().count() != 1 {
        return None;
    }
    let joined = root.join(candidate);
    let real = joined.canonicalize().ok()?;
    let real_root = root.canonicalize().ok()?;
    if real.starts_with(&real_root) {
        Some(real)
    } else {
        None
    }
}

/// Nomes de ficheiro que o indice conhece: os finais (rel_path) e os parciais
/// (`<chave>.part`) das transferencias que ainda nao acabaram. Tudo o resto
/// que estiver nos roots e lixo de uma sessao que morreu a meio.
pub fn sweep_orphan_files(roots: &Roots, expected: &HashSet<String>) -> usize {
    let mut removed = 0;
    for dir in [&roots.pinned, &roots.evictable] {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if expected.contains(&name) {
                continue;
            }
            // O indice vive dentro do root pinado desde que passou a ser por
            // utilizador. Apagar o `.sqlite` (ou, pior, so o `-wal`) durante a
            // varredura seria a app a destruir a sua propria base de dados no
            // arranque, com a ligacao aberta por cima.
            if name.starts_with(INDEX_FILE) {
                continue;
            }
            // So ficheiros: uma directoria aqui dentro nao e nossa, e apagar
            // arvores por engano e pior do que deixar bytes a mais.
            if entry.file_type().map(|t| t.is_file()).unwrap_or(false)
                && std::fs::remove_file(entry.path()).is_ok()
            {
                removed += 1;
            }
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_user_rejects_traversal() {
        assert_eq!(sanitize_user("42"), Some("42".to_string()));
        assert_eq!(sanitize_user("a_b-1"), Some("a_b-1".to_string()));
        assert_eq!(sanitize_user(""), None);
        assert_eq!(sanitize_user(".."), None);
        assert_eq!(sanitize_user("../../etc"), None);
        assert_eq!(sanitize_user("a/b"), None);
        assert_eq!(sanitize_user(&"x".repeat(65)), None);
    }

    #[test]
    fn resolve_within_rejects_escapes() {
        let dir = std::env::temp_dir().join(format!("oms-cache-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("1_mixed.m4a"), b"x").unwrap();

        assert!(resolve_within(&dir, "1_mixed.m4a").is_some());
        assert!(resolve_within(&dir, "../1_mixed.m4a").is_none());
        assert!(resolve_within(&dir, "/etc/passwd").is_none());
        assert!(resolve_within(&dir, "sub/1_mixed.m4a").is_none());
        // Ficheiro inexistente: o canonicalize falha, e um miss e a resposta
        // certa (a linha do indice vai ser marcada como perdida).
        assert!(resolve_within(&dir, "9_mixed.m4a").is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_sweep_never_eats_the_index_it_is_reading_from() {
        let base = std::env::temp_dir().join(format!("oms-cache-idx-{}", std::process::id()));
        let pinned = base.join("pinned");
        let evictable = base.join("evictable");
        std::fs::create_dir_all(&pinned).unwrap();
        std::fs::create_dir_all(&evictable).unwrap();
        std::fs::write(pinned.join(INDEX_FILE), b"db").unwrap();
        std::fs::write(pinned.join(format!("{INDEX_FILE}-wal")), b"wal").unwrap();
        std::fs::write(pinned.join("1_mixed.m4a"), b"orfao").unwrap();

        let roots = Roots {
            pinned: pinned.clone(),
            evictable,
        };
        assert_eq!(sweep_orphan_files(&roots, &HashSet::new()), 1);
        assert!(pinned.join(INDEX_FILE).exists());
        assert!(pinned.join(format!("{INDEX_FILE}-wal")).exists());
        assert!(!pinned.join("1_mixed.m4a").exists());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[test]
    fn resolve_within_rejects_symlink_out_of_root() {
        let dir = std::env::temp_dir().join(format!("oms-cache-link-{}", std::process::id()));
        let outside = std::env::temp_dir().join(format!("oms-cache-out-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let target = outside.join("secret.bin");
        std::fs::write(&target, b"segredo").unwrap();
        let link = dir.join("2_mixed.m4a");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(&target, &link).unwrap();

        assert!(resolve_within(&dir, "2_mixed.m4a").is_none());

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&outside);
    }
}
