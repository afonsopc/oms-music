# App Store: a OMS Music pública (e nada de importar de fora)

Estado em 2026-11-08. A app iOS (bundle `pt.omelhorsite.music`, team
`6FYT6632J8`, App Store Connect id `6830412208`, nome na loja "OMS Music",
no ecrã "Música") está **pronta para submeter como app pública**, mas **não
foi submetida**: o Afonso só submete depois de a Apple responder à app O
Melhor Site (em revisão desde 2026-11-08). A segunda metade deste ficheiro
("Nada de importar de fora") continua a valer sempre.

## A pergunta principal: de quem é a música (regra 5.2)

**Cada pessoa só ouve o que ela própria carregou.** Não há catálogo, loja,
biblioteca partilhada nem música posta por nós:

- Cada música tem dono (`songs.user_id`, obrigatório); a visibilidade é
  `Song.viewable_by(user) = where(user:)`. Artistas e álbuns também são por
  conta. Não há deduplicação entre contas (o mesmo ficheiro carregado por
  duas pessoas são dois ficheiros).
- O áudio só sai pelo `GET /media/:id/...`, que dá 404 a quem não é dono.
- Biblioteca, pesquisa, álbuns, artistas, rádios, misturas, Rewind, DJ,
  assistente, letras e Montagem: só a música da própria conta.
- **Duas excepções, só entre amigos aceites**: uma playlist que o dono pôs
  em "amigos" (os amigos ouvem-na) e as jams (quem está na jam ouve a música
  do anfitrião e as que os outros propõem). Não há partilha pública nem
  pesquisa entre contas. O perfil de um amigo mostra títulos e capas, sem
  áudio.
- Como entra música: na app, só os ficheiros da própria pessoa (Definições >
  Importar). O serviço à parte `import.omelhorsite.pt` (web) traz música de
  outros serviços para a MESMA biblioteca, e essa música toca também no
  iPhone. A app nunca o nomeia nem lá leva (ver abaixo).

**Risco que vejo**: a app em si é honesta ("leitor da tua própria
biblioteca"), e é isso que as notas dizem. Os pontos fracos são: (1) uma
pessoa pode pôr na biblioteca, pelo site de importação, música que não é
dela, e ouvi-la no iPhone; a Apple não vê isso na app, mas se perguntar "de
onde vem a música", a resposta honesta é "ficheiros do utilizador"; (2) as
**letras** vêm de sites de terceiros (lrclib, e o fetcher também lê o Genius)
e a app mostra "Letras via <fonte>"; letras são obras protegidas e a Apple
pode pedir a licença (os grandes usam LyricFind/Musixmatch). Se a revisão
falar disso, o mais seguro é tirar as letras de fora da app iOS (como os
Filmes no O Melhor Site). (3) As fotos e biografias de artistas vêm do
Deezer/Last.fm/Wikipedia (metadados, risco baixo).

A conta de demonstração tem só música livre: `docs/app-store/musica-livre.md`
(origem, licença e como conferir).

## O que foi feito para a revisão (2026-11-08)

| Regra | O quê | Onde |
| --- | --- | --- |
| 1.2 conteúdo das pessoas | Denunciar (motivo + texto) e bloquear: no perfil de outra pessoa ("Denunciar ou bloquear"), na jam (tocar num membro: a pessoa ou a jam; tocar numa música proposta por outra pessoa: a música). Vai para a mesma fila do site (`/admin/reports`, aviso aos admins na hora, 24 h). Bloquear = o bloqueio do site (desfaz a amizade, vale nos dois sentidos); uma jam com alguém bloqueado não aparece nem deixa entrar; bloquear na mesma jam tira a pessoa (anfitrião) ou sai | `src/features/moderation/`, backend `ModerationController` (`POST /music/reports`, `/music/blocks`), omelhorsite `Internal::MusicController#report/#block` |
| 1.2 | Termos de utilização (tolerância zero) antes de usar, se a conta ainda não os aceitou no site | `TermsGate.tsx`, `GET/POST /music/terms` |
| 5.1.1(v) | Perfil > "Apagar a minha conta" abre a confirmação de apagar do id.omelhorsite.pt dentro da app (a mesma do O Melhor Site); a música apaga-se com a conta (48 h, `Accounts::MusicDeletion`) | `src/features/account/index.tsx` |
| 5.1.1 | Perfil > Termos de utilização, Política de privacidade, Ajuda e contacto (páginas do site) | idem |
| 4.8 | No iPhone o login pede ao id sem Google/GitHub (`platform=ios` -> `ui_locales=<língua>-x-iosapp`, como o site), por isso não é preciso Sign in with Apple | `src/auth/oauth.ts`, backend `Music::AuthController#id_extra` |
| 2.1 | Conta sem o serviço "music" (vem desligado nas contas novas): um ecrã a dizê-lo, com contacto, em vez de erros | `src/features/account/ServiceGate.tsx` |
| 5.1.1 permissões | Saíram os pedidos de microfone e Face ID (a app não usa nenhum); fica a rede local (Transmitir) | `app.json` (`microphonePermission`/`faceIDPermission: false`) |
| 3.1 | Nada pago: sem compras, assinaturas, anúncios nem links para pagar | — |

**Decisão para o Afonso (importante para uma app pública)**: o serviço
"music" vem **desligado** nas contas novas (`ServicesCatalog`, nos dois
backends) e cada conta tem 100 GiB. Quem descarregar a app da loja e criar
conta vê o ecrã "A Música ainda não está ligada". Para a revisão chega (a
conta demo tem-no ligado), mas uma app pública que ninguém pode usar arrisca
uma recusa (2.1/3.2) mais tarde. Opções: ligar "music" por omissão (talvez
com uma quota menor, ex. 5 GiB, para contas novas), ou aceitar o ecrã e
ligar à mão a quem pedir.

## A ficha no App Store Connect

A app já existia (criada à mão para o TestFlight). Pôr/actualizar a ficha:

```sh
set -a; . ~/.config/oms-appstore/appreview.env; set +a   # ASC_DEMO_PASSWORD
bun scripts/asc.ts listing pt.omelhorsite.music docs/app-store/listing.json
```

`docs/app-store/listing.json`: versão (`2.1.3`, tem de ser a do
`package.json` da build escolhida), copyright "2026 Afonso Coutinho",
categoria Música, classificação etária, textos pt-PT e en-US, URLs
(privacidade `https://omelhorsite.pt/<pt|en>/privacy-policy`, suporte
`/about-us`, site `https://music.omelhorsite.pt`), contacto (Afonso
Coutinho, afonso@omelhorsite.pt, +351968374909), conta de demonstração e as
notas para a revisão (inglês). Só escreve na versão em preparação; nunca
submete.

Já posto e conferido pela API a 2026-11-08: tudo o que está no
`listing.json`, a palavra-passe da conta demo, **preço Grátis** (USD 0,
`appPriceSchedules`) e **disponível em todos os 175 países** (e nos novos).
A encriptação é só HTTPS (`ITSAppUsesNonExemptEncryption = false`): sem
perguntas de exportação e sem problema com França.

Classificação etária respondida: tudo "nenhum" excepto linguagem imprópria
"pouco frequente/ligeira" (as músicas e letras das pessoas) e conteúdo
gerado pelos utilizadores "sim" (perfis, playlists e jams entre amigos);
sem chat, sem rede social aberta, sem acesso livre à web.

## Conta de demonstração

A mesma do O Melhor Site (as contas são as mesmas): `appreview@omelhorsite.pt`
(ZITADEL, email confirmado, sem 2FA; palavra-passe só em
`~/.config/oms-appstore/appreview.env` e no App Store Connect). Na música:
conta `44vcm8mmJvuK`, serviço "music" ligado à mão a 2026-11-08, Termos
aceites, 8 músicas livres e nada de outras contas (a única amiga, `testios2`,
não tem música). Detalhes e verificação: `docs/app-store/musica-livre.md`.
Depois da revisão: mudar a palavra-passe ou apagar a conta.

## O que falta, à mão, no App Store Connect (pelo Afonso)

Só **depois** de a Apple responder à app O Melhor Site. Em
https://appstoreconnect.apple.com > **Apps** > **OMS Music** (se o site
estiver em inglês, o nome em inglês vai entre parênteses):

1. **Privacidade da app** (App Privacy), no menu da esquerda:
   - carregar em **Começar** (Get Started);
   - "Recolhem dados desta app?" **Sim, recolhemos dados**;
   - marcar os tipos da tabela "Rótulo de privacidade" abaixo e
     **Seguinte**; em cada um responder: finalidade como na tabela; "Ligado à
     identidade do utilizador?" **Sim**; "Usado para rastreio?" **Não**;
   - em **URL da política de privacidade** pôr
     `https://omelhorsite.pt/pt/privacy-policy` (se pedir);
   - no fim, **Publicar** (Publish), em cima à direita.
2. **Informações da app** (App Information) > **Direitos de conteúdo**
   (Content Rights) > **Configurar**: "A app contém, mostra ou acede a
   conteúdo de terceiros?" A resposta honesta é **Sim** (a música que cada
   pessoa carrega, as letras e as fotos de artistas), e depois "Tem os
   direitos necessários?" — isto é uma declaração tua; vê o risco das letras
   acima antes de responder. **Guardar**.
3. **A build**: no Terminal, na pasta `oms-music`, com tudo commitado:
   `bun run ios:testflight`. Uns 10-15 minutos a compilar e enviar, e mais
   uns minutos até aparecer em **TestFlight** como "Pronta a testar". Não há
   perguntas de encriptação (só HTTPS). A versão tem de ser a da ficha
   (`2.1.3`); se o `package.json` já tiver outra, muda `versionString` no
   `listing.json` e volta a correr o comando da ficha.
   Precisa de uns 10 GB livres no disco (ver "Builds" abaixo).
4. Na página da versão (menu da esquerda, **App para iOS** > **2.1.3
   Preparar para submissão**), descer até **Build** e carregar em
   **Adicionar build** (o "+"), escolher a build mais recente e **Concluído**.
   Se perguntar pela encriptação: "Nenhum dos algoritmos mencionados acima".
5. Conferir na mesma página que estão as capturas (iPhone 6,9" e 6,5"), os
   textos, a conta de demonstração em **Informações para revisão da App**
   (App Review Information) e **Lançamento da versão**: escolher
   "Lançar manualmente esta versão" se quiseres escolher o dia.
6. Em cima à direita, **Adicionar para revisão** (Add for Review) e depois
   **Enviar para revisão da App** (Submit for Review). Só isto submete.
7. Depois de aprovada: mudar a palavra-passe da `appreview` ou apagar a
   conta (é a mesma do O Melhor Site: fazer só quando as duas estiverem
   aprovadas), e pôr o link da loja em `OMS_MUSIC_APP_STORE_URL` no
   omelhorsite (o botão aparece na página da Música).

Se a Apple perguntar pela música: responder com a secção "A pergunta
principal" acima, em inglês (as notas já o dizem).

## Notas para a revisão (inglês, em `review.notes`)

Resumo: o que é (leitor da biblioteca da própria pessoa, contas grátis do O
Melhor Site); direitos da música (sem catálogo, cada conta só ouve o que
carregou, partilha só com amigos aceites, a demo só com as 8 gravações CC0 /
domínio público e de onde vêm); entrar (id próprio, sem login social, por
isso sem Sign in with Apple); conteúdo das pessoas (Termos, onde denunciar e
bloquear, 24 h, contacto); apagar conta; áudio em segundo plano, Google Cast,
as vistas web do visualizador (só animações, do nosso site), o assistente;
nada pago; encriptação só HTTPS.

## Rótulo de privacidade (App Privacy)

**Rastreio (tracking): Não.** Sem IDFA, sem SDK de publicidade nem de
análise de terceiros. Todos os dados abaixo **ligados à pessoa**, nenhum
para rastreio:

| Tipo (nome no App Store Connect) | O quê | Finalidade |
| --- | --- | --- |
| Informações de contacto > Nome (Name) | nome da conta | Funcionalidade da app |
| Informações de contacto > Endereço de email (Email Address) | email da conta | Funcionalidade da app |
| Conteúdo do utilizador > Outro conteúdo do utilizador (Other User Content) | as músicas carregadas, playlists, gostos, letras corrigidas, denúncias | Funcionalidade da app |
| Conteúdo do utilizador > Apoio ao cliente (Customer Support) | tickets abertos pelo assistente | Funcionalidade da app |
| Contactos (Contacts) | amigos e bloqueios (o "grafo" da conta; não lê os Contactos do iPhone) | Funcionalidade da app |
| Identificadores > ID do utilizador (User ID) | id da conta | Funcionalidade da app |
| Dados de utilização > Interação com o produto (Product Interaction) | o que ouves (histórico, para as misturas, o Rewind e o perfil), serviço aberto | Funcionalidade da app, Análise |
| Diagnóstico > Outros dados de diagnóstico (Other Diagnostic Data) | erros do servidor | Funcionalidade da app |
| Localização > Localização aproximada (Coarse Location) | país deduzido do IP (estatísticas) | Análise |

Não recolhe: áudio do microfone, fotos, localização precisa, contactos do
iPhone, saúde, finanças, histórico de navegação, pesquisas (ficam no
aparelho), identificador do aparelho para publicidade.

A política (`https://omelhorsite.pt/pt/privacy-policy`) é a da conta O
Melhor Site e cobre "a biblioteca" e as funções de IA. Sugestão para depois:
uma linha a nomear a OMS Music (os ficheiros de música carregados e o
histórico de reprodução) na secção 2 da política.

## Capturas

`docs/app-store/screenshots/6.9` (1320×2868, `APP_IPHONE_67`) e `6.5`
(1284×2778, `APP_IPHONE_65`, a mesma imagem reduzida e cortada 6 px em cima
e em baixo), JPEG sem alfa: leitor, início, álbum, biblioteca, playlist,
fila. Tiradas a 2026-11-08 da app a sério (build Release de simulador do
HEAD, iPhone 18 Pro Max, modo escuro, barra de estado 9:41) com a conta
`appreview` e só a música livre. Já carregadas em pt-PT e en-US (as 24 em
"COMPLETE"):

```sh
for L in pt-PT en-US; do
  bun scripts/asc.ts screenshots pt.omelhorsite.music $L APP_IPHONE_67 docs/app-store/screenshots/6.9
  bun scripts/asc.ts screenshots pt.omelhorsite.music $L APP_IPHONE_65 docs/app-store/screenshots/6.5
done
```

Para as refazer sem tocar no ecrã (o Simulador aqui não tem janela): numa
cópia limpa do HEAD (nunca no repo), `src/auth/token.ts` devolve o token de
uma sessão da `appreview` criada com
`AppSession.open!(user:, user_agent: "App Store screenshots (apagar)")`, e
um hook só dessa cópia põe a biblioteca a tocar e navega para a rota
escrita em `Documents/route.txt` do contentor da app
(`xcrun simctl get_app_container <sim> pt.omelhorsite.music data`). Uma
ligação `omsmusic://` pelo `simctl openurl` não serve: abre o aviso do
sistema "Abrir com Música?", que sem toques fica no ecrã. A sessão das
capturas foi apagada no fim.

As capas das 8 músicas e das 2 playlists da demo ("Para estudar",
"Barroco", privadas) são nossas. A fotografia de reserva da app
(`assets/images/fallbackPhoto.jpg`, Lisboa) aparece onde não há imagem (o
avatar da demo); confirmar que é tua.

## Builds

`bun run ios:testflight` (docs/testflight.md) serve também para a revisão:
compila o HEAD, passa a verificação de "Nada de importar de fora" (pára se
o bundle iOS nomear serviços de fora) e envia. `ITSAppUsesNonExemptEncryption
= false` (só HTTPS), por isso a build não fica à espera de perguntas.

**Estado a 2026-11-09**: a build para a revisão ainda **não** foi enviada.
A tentativa (HEAD `45415ad`, versão 2.1.3, build 261108.2355) passou o
prebuild, o pod install e a verificação "nada de importar de fora" (vazia),
e o archive caiu só por **disco cheio** ("No space left on device"; o Mac
ficou com 310 MB livres). Uma build de iPhone precisa de uns 8-10 GB livres
na pasta temporária. Liberta espaço e corre `bun run ios:testflight` (passo
3 da lista acima).

## Nada de importar de fora (App Store e Play Store)

A Apple recusa apps que sincronizam de outros serviços de música ou que
descarregam de sites de vídeo (regras 5.2.2 e 5.2.3, e 3.1.1 para links). Por
isso, tudo o que traz música de FORA vive num serviço à parte, o
`oms-music-import`, com a página em https://import.omelhorsite.pt. A app só
importa os ficheiros do próprio utilizador (definições > importar, que chama
`POST /songs/import`).

### Regras

- A app (iOS, Android, web e desktop) nunca volta a ter importação de fora:
  nada de sincronizar com outros serviços, importar por link, pesquisa
  externa, trocar a fonte de uma música, nem mostrar de onde veio uma música.
  As playlists mantidas por fora aparecem só como "Sincronizada"
  (`playlist.synced`), sem o nome de nenhum serviço.
- O único sítio que fala da página de importação é
  `src/features/import/elsewhere.web.tsx`: uma linha abaixo dos ficheiros, só
  na web e no desktop. Os textos ficam DENTRO desse ficheiro, nunca nos
  catálogos partilhados (`src/i18n/catalogs/*.json` vão para as apps
  nativas). O par nativo, `elsewhere.tsx`, devolve `null`. O Metro nunca leva
  um `.web.tsx` para iOS nem Android.
- A Montagem do visualizador (`src/features/montage/`, motor em `montage/`)
  só TOCA clipes que já estão na biblioteca (núcleo: `GET /montage_clips`,
  `GET/PUT /songs/:id/montage`). Ir buscar clipes novos (`/clip_fetches`, no
  serviço de importação) e os textos que falam disso vivem só em
  `src/features/montage/clipSource.web.ts`; o par nativo, `clipSource.ts`,
  diz `canFetchClips = false` e não chama nada.
- No desktop o link abre no browser do sistema pelo comando do shell
  `open_import_page` (`desktop/src-tauri/src/login.rs`), que só abre esse
  endereço fixo.
- O SDK (`@omelhorsite/sdk`) vai inteiro para dentro da app, por isso está
  remendado com `bun patch` (`patches/`, `patchedDependencies` no
  `package.json`): saíram as importações, as sincronizações, a pesquisa
  externa, a troca de fonte, o downloader das ferramentas e as palavras que
  os nomeavam. Um `bun install` limpo aplica o remendo. Ao subir a versão do
  SDK, refazer o remendo (`bun patch @omelhorsite/sdk`, editar,
  `bun patch --commit node_modules/@omelhorsite/sdk`).
- O teste `src/boot/__tests__/appStore.test.ts` falha se algum ficheiro de
  `src/` que vá para as apps nativas (tudo menos `*.web.ts(x)` e
  `__tests__`), ou os catálogos, nomear esses serviços ou a página de
  importação, e se o SDK instalado não estiver remendado.

### Verificação antes de qualquer build iOS ou Android

```bash
bunx expo export --platform ios --no-bytecode --output-dir /tmp/omsm-ios-export
bunx expo export --platform android --no-bytecode --output-dir /tmp/omsm-android-export
grep -i -o -E "spotify|youtube|soundcloud|bandcamp|yt-dlp|ytdlp|import\.omelhorsite|song_imports|external_search|rematch|match_candidates|artist_imports|artist_syncs|playlist_imports|itunes" -r /tmp/omsm-ios-export | sort | uniq -c
grep -i -o -E "spotify|youtube|soundcloud|bandcamp|yt-dlp|ytdlp|import\.omelhorsite|song_imports|external_search|rematch|match_candidates|artist_imports|artist_syncs|playlist_imports|itunes" -r /tmp/omsm-android-export | sort | uniq -c
```

O de iOS tem de sair vazio. No Android aparecem hoje duas linhas `youtube`
que não são nossas: são nomes de ícones (`youtube_activity`,
`youtube_searched_for`) na tabela de símbolos Material do `expo-symbols`
(`build/android/symbols.json`). Qualquer outra coisa trava o build.
