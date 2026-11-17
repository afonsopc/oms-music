# Google Play: o que pôr na Play Console (rascunho)

Estado em 2026-11-17: **ainda não há conta na Play Console**. Nada foi
enviado à Google. Este ficheiro tem as respostas prontas a copiar; o build
está em `docs/android.md`, secção "Google Play".

App: **OMS Music**, pacote `pt.omelhorsite.music`, grátis, sem anúncios,
sem compras. Língua principal: Português (Portugal) `pt-PT`; tradução
English (United States) `en-US`.

Regra que vale aqui como na App Store (`docs/app-store.md`, "Nada de importar
de fora"): nem a ficha, nem as capturas, nem as notas para a revisão falam
de outros serviços de música ou vídeo, da página de importação, nem de onde
vêm letras e fotos.

## Ficha da loja (Presença na loja principal)

| Campo | Limite | Ficheiro |
| --- | --- | --- |
| Nome da app | 30 | `pt-PT/title.txt`, `en-US/title.txt` ("OMS Music", 9) |
| Descrição breve | 80 | `pt-PT/short-description.txt` (79), `en-US/short-description.txt` (69) |
| Descrição completa | 4000 | `pt-PT/full-description.txt` (~1050), `en-US/full-description.txt` (~990) |
| Ícone | 512×512 PNG | `icon-512.png` |
| Gráfico de destaque | 1024×500 | `pt-PT/feature-graphic.png`, `en-US/feature-graphic.png` |
| Capturas de telemóvel | 2 a 8, 9:16 | `pt-PT/phone/*.png`, `en-US/phone/*.png` (6, 1080×1920) |

As capturas vêm das da App Store (`docs/app-store/screenshots/6.9`, conta
`appreview`, só música livre) sem a barra de estado do iPhone e com uma
frase por cima; a interface nelas está em português nas duas línguas
(refazer em inglês um dia, se valer a pena). Regenerar:
`python3 scripts/play-graphics.py`.

- Categoria: **Música e áudio** (Music & Audio). Etiquetas: leitor de
  música, biblioteca.
- Email de contacto: `afonso@omelhorsite.pt`. Site:
  `https://music.omelhorsite.pt`. Telefone: opcional (o da App Store é
  `+351968374909`).
- Sem capturas de tablet: a Play só as pede para aparecer em destaque nos
  tablets; a app corre neles na mesma.

## Política de privacidade

`https://omelhorsite.pt/pt/privacy-policy` (a mesma da app e da App Store;
em inglês `https://omelhorsite.pt/en/privacy-policy`). A Play só aceita um
URL: pôr o `pt`. A política diz "não se destina a menores de 16 anos" e
"as apps não usam o identificador de publicidade nem SDKs de publicidade ou
de análise de terceiros".

## Acesso à app (App access)

"Todas ou algumas funcionalidades estão restritas" > adicionar instruções:

- Nome: `Conta de demonstração`
- Utilizador: `appreview@omelhorsite.pt`
- Palavra-passe: a de `~/.config/oms-appstore/appreview.env`
  (`ASC_DEMO_PASSWORD`; nunca no git). É a mesma conta da revisão da App
  Store (8 músicas livres, serviço "music" ligado). Não criar contas novas.
- Instruções (inglês):

  > Tap "Entrar" (Sign in). It opens our own account service
  > (id.omelhorsite.pt) in a browser tab; sign in with the email and
  > password above and you return to the app. The account has 8 public
  > domain / CC0 recordings. Each account only plays the audio files its
  > owner uploaded (Settings > Import). No purchases, no ads.

Depois da revisão das duas lojas: mudar a palavra-passe ou apagar a conta
(`docs/app-store.md`).

## Anúncios

**Não**, a app não tem anúncios.

## Classificação de conteúdo (questionário IARC)

- Email: `afonso@omelhorsite.pt`.
- Categoria: **Todos os outros tipos de apps** (não é jogo nem rede social
  aberta; é um leitor da biblioteca da própria pessoa).
- Violência, medo, sexualidade, linguagem, drogas, jogo a dinheiro: **Não**
  (a app não traz conteúdo nosso; a música é a que cada pessoa carrega).
- "Os utilizadores interagem ou trocam conteúdo?" **Sim**: entre amigos
  aceites (perfis, playlists partilhadas com amigos, jams). Há denunciar e
  bloquear e termos com tolerância zero.
- "Partilha a localização do utilizador com outros?" **Não**.
- "Permite comprar bens digitais?" **Não**.
- "Acesso livre à internet (browser)?" **Não** (as vistas web são só páginas
  do nosso site, para o visualizador).
- Esperado: PEGI 3 / ESRB Everyone com a nota "Os utilizadores interagem".

## Público-alvo e conteúdo

- Faixas etárias: **16-17** e **18 ou mais** (os Termos e a política pedem
  16 anos). Nada abaixo de 13, por isso não entra no programa Famílias.
- "A app pode atrair crianças sem querer?" **Não**.

## Outras declarações

- App de notícias: **Não**. App governamental: **Não**. Funcionalidades
  financeiras: **Nenhuma**. Saúde: **Não**. VPN: **Não**.
- **ID de publicidade**: a app **não** usa o ID de publicidade (o manifest
  final não tem `com.google.android.gms.permission.AD_ID`).
- **Serviço em primeiro plano** (Foreground service permissions): tipo
  `mediaPlayback`, "Reprodução de música em segundo plano: a música que a
  pessoa pôs a tocar continua com o ecrã desligado ou noutra app, com os
  controlos na notificação". A consola pede um vídeo curto (link) a mostrar
  isso: gravar no telemóvel (tocar, sair da app, a notificação com os
  controlos), sem som de música que não seja livre.
- **Apagar a conta** (Data safety > Eliminação de dados): URL
  `https://id.omelhorsite.pt/ui/v2/login/account#delete` (entra-se e apaga-se,
  sem precisar da app; é o mesmo que o Perfil > "Apagar a minha conta" abre).
  A música apaga-se com a conta (48 h). Também por email:
  `afonso@omelhorsite.pt`.

## Segurança dos dados (Data safety)

Respostas gerais:

- "Recolhe ou partilha dados de utilizador?" **Sim**.
- "Todos os dados são encriptados em trânsito?" **Sim** (só HTTPS).
- "Dá forma de pedir a eliminação dos dados?" **Sim** (URL acima).
- Partilha com terceiros: **Não** (os prestadores que correm o serviço por
  nós, listados na política, não contam como partilha para a Google).
- Sem anúncios, sem ID de publicidade, sem venda de dados.

Dados recolhidos (todos **recolhidos, não partilhados**, ligados à conta
salvo onde se diz, **obrigatórios** para usar a app salvo onde se diz):

| Tipo na Play | O quê | Finalidade |
| --- | --- | --- |
| Informações pessoais > Nome | nome da conta | Funcionalidade da app, Gestão da conta |
| Informações pessoais > Endereço de email | email da conta | Funcionalidade da app, Gestão da conta |
| Informações pessoais > IDs do utilizador | id da conta | Funcionalidade da app, Gestão da conta |
| Áudio > Ficheiros de música | os ficheiros que a pessoa carrega (opcional: só quem importa) | Funcionalidade da app |
| Fotos e vídeos > Fotos | capa de playlist ou foto de perfil, se a pessoa escolher uma (opcional) | Funcionalidade da app |
| Atividade na app > Interações com a app | o que se ouve (histórico, para misturas, Rewind e perfil), gostos | Funcionalidade da app, Estatísticas, Personalização |
| Atividade na app > Outro conteúdo gerado pelo utilizador | playlists, letras corrigidas, amigos e bloqueios, denúncias, conversas com o assistente (opcional) | Funcionalidade da app |
| Mensagens > Outras mensagens na app | pedidos de suporte abertos pelo assistente (opcional) | Funcionalidade da app |
| Localização > Localização aproximada | país deduzido do IP (estatísticas) | Estatísticas |
| Informações e desempenho da app > Diagnóstico | erros do servidor ligados ao pedido | Funcionalidade da app |
| Atividade na app > Outras ações | eventos do Google Cast (descobrir TVs, sessões), recolhidos pelo SDK da Google, sem identificador, não ligados à pessoa | Estatísticas |

Não recolhe: localização exacta, contactos do telemóvel, SMS, chamadas,
calendário, saúde, finanças, histórico de navegação, pesquisas (ficam no
telemóvel), gravações de voz (a app não grava; o build da Play nem pede o
microfone), ID de publicidade.

Sobre o Google Cast: o SDK (`play-services-cast-framework`) manda à Google
estatísticas de uso do Cast, encriptadas, sem identificadores, não
partilhadas, sem forma de recusar nem apagar
(https://developers.google.com/cast/docs/android_sender/data_disclosure).

Sugestão (como na App Store): uma linha na política a nomear a OMS Music
(os ficheiros de música carregados e o histórico de reprodução).

## Permissões do build da Play (o que a Play pergunta)

Ver `docs/android.md` ("Google Play") e o
`oms-music-play-<versionCode>.permissions.txt` ao lado do AAB.

| Permissão | Porquê |
| --- | --- |
| `INTERNET` | falar com o servidor da conta (a biblioteca, o áudio, as letras) |
| `ACCESS_NETWORK_STATE` | saber se há rede (modo sem rede, transferências só em Wi-Fi) |
| `ACCESS_WIFI_STATE` | Google Cast: encontrar TVs e colunas na rede Wi-Fi |
| `FOREGROUND_SERVICE` | a música continua a tocar com a app em segundo plano |
| `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | o tipo desse serviço (Android 14+): reprodução de media |
| `WAKE_LOCK` | não deixar o telemóvel adormecer a meio de uma música ou transferência |
| `MODIFY_AUDIO_SETTINGS` | o leitor de áudio (foco de áudio, saída) |
| `VIBRATE` | a vibração curta ao tocar em botões (haptics) |
| `pt.omelhorsite.music.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | interna do Android (AndroidX), não é pedida à pessoa |

Fora do build da Play (o APK do site ainda as tem, vêm das bibliotecas e do
template): `REQUEST_INSTALL_PACKAGES` (nunca usada), `RECORD_AUDIO`,
`USE_BIOMETRIC`, `USE_FINGERPRINT`, `SYSTEM_ALERT_WINDOW`,
`READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`. Nenhuma é "sensível" para
a Play, por isso não há formulário de permissões especial.

## O que só se faz dentro da Play Console (pelo Afonso)

1. **Criar a conta de programador** (25 USD, uma vez; pessoal ou de
   organização). Verificação de identidade (documento) e, numa conta
   pessoal, do telemóvel. Pode demorar uns dias.
2. **Contas pessoais novas**: antes de publicar em produção a Google obriga
   a um **teste fechado com pelo menos 12 testadores durante 14 dias
   seguidos**. Depois pede-se o acesso à produção (umas perguntas sobre o
   teste). Uma conta de organização (precisa de número D-U-N-S) não tem
   esta regra.
3. **Criar a app**: nome "OMS Music", língua pt-PT, App, Grátis, aceitar as
   declarações.
4. **Assinatura**: na primeira subida, Play App Signing. Escolher usar a
   nossa chave `oms` (a ferramenta PEPK da consola exporta-a cifrada) para
   que quem tem o APK do site possa actualizar pela loja sem apagar a app
   (`docs/android.md`). Se a Google gerar a chave, a `oms` fica só como
   chave de upload.
5. **Subir o AAB** (`~/Documents/oms/builds/android/oms-music-play-<versionCode>.aab`)
   para a faixa de teste interno/fechado, e depois de produção. Cada
   subida precisa de um versionCode maior (o script já o faz pela hora).
6. Preencher, com as respostas acima: Acesso à app, Anúncios,
   Classificação de conteúdo, Público-alvo, Segurança dos dados (com o URL
   de apagar a conta), ID de publicidade, Serviço em primeiro plano (com o
   vídeo), Apps de notícias/governo/finanças/saúde.
7. Ficha da loja: textos e gráficos de `store/play/`, categoria, contacto,
   política de privacidade. Países: todos.
8. Enviar para revisão (Visão geral da publicação > Enviar alterações).
9. Depois de publicada: decidir se o site continua a dar o APK (as duas
   coisas podem viver juntas se a chave for a mesma) e pôr o link da Play
   na página `/android/`.
