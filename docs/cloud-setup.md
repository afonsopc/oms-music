# Ambiente da sessão cloud (Ubuntu 24.04)

A imagem já traz quase tudo: node 22 + bun 1.3.11, ruby 3.3.6, python, go,
rust, git, ripgrep, e **playwright com Chromium em `/opt/pw-browsers`**. O que
falta para os nossos três repos é pouco, e é isso que o script faz.

- **Script**: `docs/cloud-setup.sh` (colar inteiro na caixa "Setup script").
- **Variáveis**: o bloco abaixo (caixa "Environment variables").

---

## Caixa "Environment variables"

Formato `.env`, e a própria caixa avisa que é visível a quem use o ambiente:
**nada de segredos**.

```
CI=true
EXPO_NO_TELEMETRY=1
NODE_OPTIONS=--max-old-space-size=4096
```

Nenhuma é obrigatória. `CI=true` cala prompts interactivos do Expo e do
bundler; `NODE_OPTIONS` só interessa se o export web morrer por memória (15 GB
chegam bem, mas é barato deixar). A app aponta ao backend de produção por
omissão; para a mandar a outro sítio existe `EXPO_PUBLIC_API_BASE_URL`.

---

## O que o script instala, e porquê tão pouco

| Instala | Porquê |
| --- | --- |
| CLI do `osnosite` | Única ferramenta nossa fora da imagem. Só para LER estado. |
| `bundler` | O ruby vem, o bundler nem sempre; o backend do omelhorsite precisa. |

Não instala dependências de projecto de propósito: `bun install` e
`bundle install` correm-se dentro do repo em que se vai trabalhar. No
`oms-music` o primeiro comando é

```bash
bun install --frozen-lockfile && bun run typecheck && bun run lint && bun test
```

e deve dar 0 erros, 0 avisos e 841 testes a passar.

---

## Duas armadilhas desta imagem

**O `prettier` está instalado globalmente. Não o corras neste repo.** O
`oms-music` não tem config de prettier e está escrito a ~100 colunas; o
prettier assume 80 e reformata ficheiros inteiros, afogando o diff real em
ruído. Já aconteceu uma vez e foi preciso reverter.

**Não há `gh`.** O GitHub é pelo MCP. E não há daemon de docker, portanto nada
de containers.

---

## A parte boa: dá para VER a web

Havia a ideia de que a sessão cloud trabalhava às cegas. Com o Chromium do
Playwright não é verdade para a web, e isso muda o que se pode dar por
verificado. O export estático serve-se e fotografa-se:

```bash
bash scripts/build-web.sh                 # 2-3 min, produz dist/
python3 -m http.server 4173 -d dist &     # servidor estático
# depois, com playwright (node ou python), abrir e fotografar:
#   http://localhost:4173/home            390x844   -> telemóvel
#   http://localhost:4173/home            1440x900  -> shell desktop
#   http://localhost:4173/playlist/<id>   nos dois tamanhos
```

Uma sessão SEM utilizador autenticado só vê os ecrãs de entrada; para ver a
app a sério é preciso sessão, e essa não vive aqui. Ainda assim, é o
suficiente para apanhar layout partido, tipografia errada (o caso do Druk
Wide) e regressões do shell nos dois lados dos 900px.

O que continua a não ter: iOS, macOS, Safari e qualquer build nativa. Nada de
`xcodebuild` nem de Tauri; o `desktop/` lê-se e edita-se, constrói-se na
máquina do dono.

---

## Autenticação

O que a sessão precisa mesmo é de **escrita no GitHub** (via MCP), e isso
chega para o trabalho que lhe foi dado: commit e push em `master`.

O token do `osnosite` **não deve ir na caixa das variáveis** - é um segredo e
aquela caixa é pública para quem use o ambiente. E daria pouco: publicar em
produção exige aprovação do dono com passkey no dashboard, portanto o máximo
seria criar releases e staging, e isso é melhor ficar de quem depois consegue
abrir o site e olhar. A CLI fica instalada para leitura de estado. Se ainda
assim quiseres dar-lhe o token, usa o mecanismo de SEGREDOS da plataforma, se
existir, nunca a caixa das variáveis.
