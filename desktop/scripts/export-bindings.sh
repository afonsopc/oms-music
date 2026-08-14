#!/usr/bin/env bash
# Regenera desktop/bindings.ts a partir do builder do tauri-specta (o teste
# export_bindings em src-tauri/src/lib.rs). Correr sempre que um comando ou
# evento Rust mudar; o diff do bindings.ts entra no git como codigo revisto.
set -euo pipefail
cd "$(dirname "$0")/../src-tauri"
cargo test --quiet export_bindings
echo "==> desktop/bindings.ts regenerado"
