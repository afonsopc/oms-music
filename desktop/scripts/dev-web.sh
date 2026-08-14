#!/usr/bin/env bash
# beforeDevCommand do tauri.conf.json: arranca o dev server do expo (porta
# 8081, o devUrl do shell). Resolve o caminho pelo proprio ficheiro para nao
# depender do cwd com que o tauri-cli invoca o comando.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec bun run web
