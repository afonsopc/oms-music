# Ambiente da sessão cloud (Linux)

Para colar no setup do ambiente. Testado contra o que a app usa hoje: bun
1.3.11, node 26.x, Expo SDK 57.

## Script de setup

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. bun (o gestor de pacotes E o runner de testes deste repo).
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

# 2. Dependências. O lockfile manda; se ele não bater com o package.json é um
#    erro a corrigir, não a contornar com um install solto.
bun install --frozen-lockfile

# 3. Prova de que o ambiente está bom (deve dar 0, 0 e "841 pass").
bun run typecheck
bun run lint
bun test
```

O `bash scripts/build-web.sh` (export estático do Expo) também corre em Linux e
é o gate a usar sempre que se mexe em rotas ou no shell. Demora 2-3 minutos.

**Não instales `watchman`, Xcode, Android SDK nem toolchain de Rust**: nada
disso é usável aqui e só atrasa o arranque. O `desktop/` (Tauri) pode ser
LIDO e editado; construir é trabalho da máquina do dono.

## Variáveis de ambiente

Nenhuma é precisa para compilar, correr testes ou fazer o export web. A app
lê o backend de produção por omissão.

| Variável | Para quê | Precisa? |
| --- | --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | apontar a app a outro backend | Não. Sem ela usa produção. |
| `CI=true` | silencia prompts do Expo e do bundler | Recomendada. |
| `NODE_OPTIONS=--max-old-space-size=4096` | o export web é pesado | Só se o export morrer por memória. |

**Não ponhas segredos aqui.** Esta sessão não publica nada: não precisa de
token do osnosite, nem de chaves da Apple, nem da chave do updater, nem da
chave do OpenRouter (o trabalho de IA que está no backlog é desenho e
proposta, e a chave vive nas credentials do Rails, noutro repo).

Se quiseres que ela consiga fazer push directamente, o ambiente precisa de
acesso de escrita ao `github.com/afonsopc/oms-music` - e nada mais.
