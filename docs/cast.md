# Transmitir: Chromecast, AirPlay e TVs DLNA

Um botão (o ícone de transmitir no mini-leitor, no Now Playing e na barra do
desktop) abre a lista **Transmitir**:

- **Tocar aqui** e os teus aparelhos (a mudança de aparelho da app, src/remote);
- **TVs e colunas**: Chromecast, AirPlay e, no computador, TVs DLNA.

Enquanto uma TV toca, o leitor diz "A tocar em Sala (Chromecast)" (a mesma
faixa do "A tocar em…" dos aparelhos da app).

## Como funciona

`src/cast/`:

| ficheiro | o quê |
| --- | --- |
| `session.ts` | A sessão. A fila continua a ser a do motor; o motor fica calado (sem fonte) e a TV toca. Um decorador do transporte (`setCastTransportDecorator`, por fora do remoto) manda play/pausa/saltar/voltar/procurar/volume para a TV. Mexer na fila mexe no motor e a TV recebe a fila nova. A TV a passar de música move o cursor do motor (`engine.alignQueueIndex`, sem carregar som). Os comandos de outros aparelhos (remote/commands) passam pelo mesmo caminho (`castAwareEngine`). |
| `media.ts`, `sign.ts` | Os itens para a TV: `POST /media/cast_urls` (backend) assina de uma vez o áudio e a capa (24 h). O token da sessão nunca vai para a TV. |
| `drivers/webCast.ts` | Chromecast na web (SDK de emissor do Google, Chrome/Edge). A lista de TVs é a do Chrome. |
| `drivers/nativeCast.ts` | Chromecast em iOS/Android (`react-native-google-cast` 4.9.1, plugin em `app.config.js`). Descoberta dentro da lista. |
| `drivers/dlna.ts` | TVs DLNA no desktop (`desktop/src-tauri/src/dlna.rs`: SSDP, SOAP AVTransport/RenderingControl e um proxy HTTP local, porque muitas TVs não abrem HTTPS). |
| `airplayWeb.ts` | AirPlay no Safari/WKWebView: o próprio `<audio>` muda de saída. |
| iOS AirPlay | `modules/oms-native/ios/OmsAirPlayModule.swift`: AVRoutePickerView por cima da linha "AirPlay" e a rota actual. O leitor continua no telemóvel (ecrã bloqueado, Now Playing e comandos como sempre). |

Com fila nativa (Chromecast) a TV recebe uma janela de 30 músicas e passa de
música sozinha, com o telemóvel bloqueado ou a app fechada; quando faltam 3,
a app manda mais. Sem fila nativa (DLNA) é a app que manda a seguinte, por
isso o desktop tem de ficar aberto.

O que a TV não faz: stems/karaoke, EQ, velocidade (tocam a mistura normal).

## O receptor próprio (os visuais na TV)

O receptor está em <https://music.omelhorsite.pt/cast/receiver/>
(`public/cast/receiver/index.html`, sobe com o build da web): toca a fila e
mostra o motor /viz/ em ecrã inteiro, com a letra palavra a palavra e as
secções (análise e letra por `GET /media/cast_viz` com um token de 24 h). Para
ver num separador: `/cast/receiver/?demo=<url de um áudio>`.

Está registado na Google Cast SDK Developer Console
(<https://cast.google.com/publish>) como **Custom Receiver** "OMS Music":

- **Application ID: `92D04F41`** (desde a 2.1.1).
- Receiver Application URL: `https://music.omelhorsite.pt/cast/receiver/`.
- Estado: **Unpublished**, ou seja, só abre nos aparelhos registados na consola.

O id está no código como omissão em dois sítios (têm de ser iguais):

- `src/cast/config.ts` (`OMS_RECEIVER_APP_ID`): web e app do Mac (o desktop
  leva o build da web);
- `app.config.js` (plugin `react-native-google-cast`, `receiverAppId`): iOS e
  Android. O SDK nativo lê-o no arranque, por isso mudá-lo pede build novo.

`EXPO_PUBLIC_CAST_APP_ID=<id>` no build sobrepõe os dois (ex. `CC1AD845`, o
**Default Media Receiver** do Google: capa, título, artista e a barra, sem
visuais).

### O que falta ao dono

1. **Registar o Chromecast/TV como aparelho de teste.** Na consola,
   **Devices** → **Add New Device**: o número de série do Chromecast (na
   caixa, na etiqueta do aparelho ou na app Google Home, Definições do
   aparelho → Informações; nas TVs com Google TV, Definições → Sistema →
   Acerca de) e uma descrição. Espera ~15 minutos até ficar "Ready for
   Testing" e **reinicia o Chromecast/TV** (desligar da corrente e voltar a
   ligar). Sem isto o aparelho não abre o receptor (a app não consegue ligar).
2. **Para abrir a todos**: quando estiver bem testado, **Publish** na
   aplicação, na consola. O Google aprova em minutos a algumas horas e depois
   qualquer Chromecast o abre, sem registo nem build novo.

## Testar

- `bun test src/cast` (sessão, fila, URLs assinados).
- `cd desktop/src-tauri && cargo test dlna` (XML, tempos, tokens);
  `cargo test live_ -- --ignored --nocapture` vê as TVs da rede (só leituras: nunca põe nada a tocar) e o proxy.
- Um Chromecast a sério não se simula: o SDK do emissor no Chrome só fala com
  aparelhos reais. O receptor próprio vê-se num separador com `?demo=`.
