# TestFlight (iOS, conta paga)

A app iOS "Música" (`pt.omelhorsite.music`, team `6FYT6632J8`) vai para o
TestFlight a partir do Mac, sem EAS na nuvem:

```bash
bun run ios:testflight              # compila o HEAD e envia
UPLOAD=0 bun run ios:testflight     # só o .ipa
bun scripts/asc.ts builds pt.omelhorsite.music   # estado no App Store Connect
```

`scripts/ios-testflight.sh` faz uma cópia limpa do HEAD (só vai o que está
commitado; `WORK=` muda a pasta, por omissão `$TMPDIR/oms-music-testflight`),
`bun install`, `OMS_PAID_TEAM=1 expo prebuild` (com Associated Domains, ver
`app.config.js`), `pod install` com o `GEM_PATH` do brew (o gem json-3.0.2 em
`~/.local/share/gem` parte o CocoaPods), a verificação de `docs/app-store.md`
(pára se o bundle iOS nomear serviços de fora), `xcodebuild archive` e
`-exportArchive` com `method app-store-connect` e `destination upload`.

- Build number = data e hora (`AAAAMMDDHHMM`, posto no Info.plist depois do
  prebuild); a versão é a do `package.json` (docs/DEVELOPMENT.md, "Versões"). `ITSAppUsesNonExemptEncryption`
  é `false` no `app.json` (só HTTPS normal), por isso as builds não ficam à
  espera da pergunta da exportação.
- Chave da App Store Connect API em `~/.appstoreconnect/oms-ci.env`
  (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH`, `APPLE_TEAM_ID`; papel App
  Manager). `scripts/asc.ts` fala com a API (JWT ES256) e nunca escreve a
  chave.
- Assinatura: a chave App Manager não tem acesso à assinatura na nuvem, por
  isso o certificado "Apple Distribution" (válido até 2027-11-04) vive no
  porta-chaves `~/Library/Keychains/oms-ci.keychain-db` (password em
  `~/.appstoreconnect/dist/keychain.pass`, o script destranca-o). O archive
  assina em automático; o export assina com Apple Distribution e o perfil
  "OMS App Store pt.omelhorsite.music", que `asc.ts profile` cria/renova pela
  API e instala.
- Bundle id registado pela API com Associated Domains (`webcredentials` e
  `applinks` em omelhorsite.pt).
- A ficha da app no App Store Connect não se cria pela API: fez-se à mão
  (Apps > + > Nova app).
- Testers internos: grupo "OMS" com o dono da conta,
  `bun scripts/asc.ts testers pt.omelhorsite.music` (uma vez; o grupo recebe
  todas as builds e não passa pela revisão da Apple).

## App Store pública: ainda não

O TestFlight interno não passa pela revisão. Antes de submeter à App Store tem
de estar acabada a saída da sincronização com outros serviços e dos
descarregamentos de vídeo para o serviço de importação à parte
(`docs/app-store.md`, import.omelhorsite.pt); só então submeter.
