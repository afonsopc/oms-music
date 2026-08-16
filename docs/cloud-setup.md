# Ambiente da sessão cloud (Linux)

Pensado para servir os TRÊS repos - `oms-music`, `omelhorsite` e `osnosite` -
e não só a app de música. Por isso o script instala ferramentas, não
dependências de um projecto: cada repo faz o seu install quando for aberto.

---

## Caixa "Setup script"

```bash
#!/bin/bash
set -uo pipefail

# Ferramentas partilhadas pelos três repos. Nada aqui é específico de um
# projecto: as dependências de cada um instalam-se dentro dele, com o
# lockfile que ele traz.

# --- bun: gestor de pacotes e runner de testes do oms-music e do osnosite CLI
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
fi
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
# O PATH acima morre com este script; o link é o que faz o bun existir para a
# sessão que arranca a seguir.
ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bun 2>/dev/null \
  || sudo ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bun 2>/dev/null || true

# --- CLI do osnosite (publicação de sites; ver a nota sobre autenticação)
bun add -g osnosite >/dev/null 2>&1 || true
ln -sf "$BUN_INSTALL/bin/osnosite" /usr/local/bin/osnosite 2>/dev/null \
  || sudo ln -sf "$BUN_INSTALL/bin/osnosite" /usr/local/bin/osnosite 2>/dev/null || true

# --- Ruby + bundler: backend Rails do omelhorsite
if ! command -v ruby >/dev/null 2>&1; then
  (sudo apt-get update -qq && sudo apt-get install -y -qq ruby-full build-essential libpq-dev) || true
fi
command -v gem >/dev/null 2>&1 && (gem install bundler --no-document >/dev/null 2>&1 || true)

# --- Diagnóstico: o que ficou disponível, para não haver surpresas depois.
echo "--- ferramentas"
for t in bun node ruby bundle osnosite git; do
  printf '%-10s %s\n' "$t" "$(command -v "$t" 2>/dev/null || echo 'EM FALTA')"
done
```

Notas sobre o que ele NÃO faz, de propósito:

- **Não corre `bun install` nem `bundle install`.** Cada repo tem o seu
  lockfile e a sessão instala quando abre o repo em que vai trabalhar; correr
  os três à partida gasta minutos que muitas vezes não se usam.
- **Não instala Xcode, Android SDK, watchman nem toolchain de Rust.** Numa
  máquina Linux sem dispositivos nada disso se usa: não há builds de iOS nem
  de macOS. O `desktop/` (Tauri) pode ser lido e editado; construir é trabalho
  da máquina do dono.
- **Não faz login em lado nenhum** (ver abaixo).

Primeiro comando dentro do `oms-music`, quando lá chegar:
`bun install --frozen-lockfile && bun run typecheck && bun run lint && bun test`
(deve dar 0 erros, 0 avisos e 841 testes a passar).

---

## Caixa "Environment variables"

Formato `.env`, e a própria caixa avisa: **é visível a quem use o ambiente, não
mete lá segredos.** Por isso só isto:

```
CI=true
EXPO_NO_TELEMETRY=1
NODE_OPTIONS=--max-old-space-size=4096
```

- `CI=true` cala prompts interactivos do Expo e do bundler, que de outra forma
  ficam à espera de uma tecla que ninguém carrega.
- `NODE_OPTIONS` só interessa se o export web (`scripts/build-web.sh`) morrer
  por memória; é barato deixar lá.

Nenhuma variável é precisa para compilar, correr testes ou fazer o export: a
app aponta ao backend de produção por omissão. Se algum dia quiseres que ela
aponte a outro, é `EXPO_PUBLIC_API_BASE_URL`.

---

## Autenticação: o que dá e o que não dá

O dono pediu "uma authzita". A resposta honesta tem duas partes.

**O que dá, e é o que interessa:** acesso de escrita ao GitHub. Se o ambiente
já traz credenciais de git (a maioria destas plataformas traz), a sessão faz
push sozinha e não é preciso mais nada. É a única autenticação que ela
realmente precisa para o trabalho que lhe foi dado.

**O que não deve ser feito:** pôr o token do osnosite na caixa das variáveis.
A própria caixa diz que é visível a quem use o ambiente; um token de
publicação nessas condições é um segredo que deixou de o ser. E não ganharia
grande coisa: **publicar em produção exige aprovação do dono no dashboard**
(step-up com passkey), portanto o melhor que a sessão conseguiria era criar
releases e staging - e mesmo isso é preferível ficar do lado de quem consegue
depois olhar para o site e ver se está bem, que não é o caso de uma máquina
sem browser.

Por isso a CLI fica instalada (para ler estado: `osnosite website <slug>
status`, `releases`, `deployments`) e a publicação continua a ser tua. Se
mesmo assim quiseres dar-lhe o token, usa o mecanismo de SEGREDOS da
plataforma se existir - nunca a caixa das variáveis - e conta com o passo de
aprovação na mesma.
