#!/usr/bin/env bun
// App Store Connect API, só o que as builds para o TestFlight precisam.
// Chave em ~/.appstoreconnect/oms-ci.env (ASC_KEY_ID, ASC_ISSUER_ID,
// ASC_KEY_PATH, APPLE_TEAM_ID); nunca escreve a chave em lado nenhum.
//
//   bun asc.ts ensure <bundle id> [nome] [capacidade...]
//                                         regista o bundle id (se faltar) e liga as capacidades
//                                         (APP_GROUPS, PUSH_NOTIFICATIONS, ASSOCIATED_DOMAINS...)
//   bun asc.ts profile <bundle id> [texto...]
//                                         perfil App Store válido, instalado; escreve o nome. Os
//                                         textos (ex.: group.pt.omelhorsite.app) têm de estar no
//                                         perfil, senão faz-se um novo (capacidade ligada depois)
//   bun asc.ts app <bundle id>            sai 0 se a app existe no App Store Connect
//   bun asc.ts builds <bundle id>         últimas builds e o estado
//   bun asc.ts testers <bundle id> [grupo] [email]
//                                         grupo interno (por omissão "OMS") com o dono da conta
//   bun asc.ts listing <bundle id> <ficha.json>
//                                         põe a ficha da versão em preparação (textos, URLs,
//                                         categorias, idade, notas para a revisão). NUNCA submete.
//   bun asc.ts screenshots <bundle id> <locale> <displayType> <pasta>
//                                         troca as capturas dessa língua e tamanho pelas da pasta
//                                         (.jpg/.png por ordem do nome; ex.: APP_IPHONE_67, APP_IPHONE_65)
//   bun asc.ts req GET /v1/apps           pedido cru
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
// O tsconfig da app só tem os tipos de node:fs (src/types/node-shims.d.ts):
// o md5 vem do Bun e os bytes leem-se como Uint8Array.
declare const Bun: { CryptoHasher: new (alg: string) => { update(b: Uint8Array): { digest(enc: string): string } } };
const readBytes = (path: string): Uint8Array => (readFileSync as unknown as (p: string) => Uint8Array)(path);

const HOME = process.env.HOME!;
const envFile = process.env.ASC_ENV || `${HOME}/.appstoreconnect/oms-ci.env`;
const env: Record<string, string> = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "").replace(/^(~|\$HOME|\$\{HOME\})/, HOME)];
    }),
);

const b64u = (b: Uint8Array | string) => (typeof b === "string" ? Buffer.from(b, "utf8") : Buffer.from(b)).toString("base64url");
let jwt = "";
let jwtExp = 0;
async function token() {
  const now = Math.floor(Date.now() / 1000);
  if (jwt && now < jwtExp - 60) return jwt;
  const pem = readFileSync(env.ASC_KEY_PATH, "utf8");
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  jwtExp = now + 1100;
  const head = b64u(JSON.stringify({ alg: "ES256", kid: env.ASC_KEY_ID, typ: "JWT" }));
  const body = b64u(JSON.stringify({ iss: env.ASC_ISSUER_ID, iat: now, exp: jwtExp, aud: "appstoreconnect-v1" }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${body}`));
  jwt = `${head}.${body}.${b64u(new Uint8Array(sig))}`;
  return jwt;
}

async function api(method: string, path: string, data?: unknown): Promise<any> {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: data === undefined ? undefined : typeof data === "string" ? data : JSON.stringify(data),
  });
  const txt = await res.text();
  const json = txt ? JSON.parse(txt) : {};
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${(json.errors || []).map((e: any) => e.detail || e.title).join("; ")}`);
    (err as any).status = res.status;
    throw err;
  }
  return json;
}

const q = encodeURIComponent;
async function bundleIdFor(identifier: string) {
  const r = await api("GET", `/v1/bundleIds?filter[identifier]=${q(identifier)}`);
  const b = r.data.find((x: any) => x.attributes.identifier === identifier);
  if (!b) throw new Error(`bundle id ${identifier} não está registado`);
  return b;
}
async function appFor(identifier: string) {
  const r = await api("GET", `/v1/apps?filter[bundleId]=${q(identifier)}`);
  return r.data.find((x: any) => x.attributes.bundleId === identifier) ?? null;
}

async function ensure(identifier: string, name?: string, capabilities: string[] = []) {
  let bundle = (await api("GET", `/v1/bundleIds?filter[identifier]=${q(identifier)}`)).data.find(
    (x: any) => x.attributes.identifier === identifier,
  );
  if (!bundle) {
    bundle = (
      await api("POST", "/v1/bundleIds", {
        data: { type: "bundleIds", attributes: { identifier, name: name || identifier.replace(/\./g, " "), platform: "IOS" } },
      })
    ).data;
    console.log(`bundle id ${identifier} registado`);
  }
  const have = new Set(
    (await api("GET", `/v1/bundleIds/${bundle.id}/bundleIdCapabilities`)).data.map((c: any) => c.attributes.capabilityType),
  );
  for (const cap of capabilities) {
    if (have.has(cap)) continue;
    await api("POST", "/v1/bundleIdCapabilities", {
      data: {
        type: "bundleIdCapabilities",
        attributes: { capabilityType: cap },
        relationships: { bundleId: { data: { type: "bundleIds", id: bundle.id } } },
      },
    });
    console.log(`${identifier}: ${cap} ligada`);
  }
}

async function profile(identifier: string, needles: string[] = []) {
  const name = `OMS App Store ${identifier}`;
  const bundle = await bundleIdFor(identifier);
  const certs = (await api("GET", `/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=50`)).data.filter(
    (c: any) => new Date(c.attributes.expirationDate).getTime() > Date.now(),
  );
  if (!certs.length) throw new Error("não há certificado Apple Distribution válido (ver docs)");
  const found = (await api("GET", `/v1/profiles?filter[name]=${q(name)}&include=certificates&limit=20`)).data;
  const soon = Date.now() + 14 * 86400e3;
  let p = found.find(
    (x: any) =>
      x.attributes.profileState === "ACTIVE" &&
      new Date(x.attributes.expirationDate).getTime() > soon &&
      needles.every((n) => (Buffer.from(x.attributes.profileContent || "", "base64") as unknown as { includes(s: string): boolean }).includes(n)) &&
      certs.every((c: any) => x.relationships?.certificates?.data?.some((d: any) => d.id === c.id)),
  );
  if (!p) {
    for (const old of found) await api("DELETE", `/v1/profiles/${old.id}`);
    p = (
      await api("POST", "/v1/profiles", {
        data: {
          type: "profiles",
          attributes: { name, profileType: "IOS_APP_STORE" },
          relationships: {
            bundleId: { data: { type: "bundleIds", id: bundle.id } },
            certificates: { data: certs.map((c: any) => ({ type: "certificates", id: c.id })) },
          },
        },
      })
    ).data;
  }
  const content = Buffer.from(p.attributes.profileContent, "base64");
  for (const dir of [`${HOME}/Library/Developer/Xcode/UserData/Provisioning Profiles`, `${HOME}/Library/MobileDevice/Provisioning Profiles`]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${p.attributes.uuid}.mobileprovision`, content);
  }
  console.log(name);
}

async function builds(identifier: string) {
  const app = await appFor(identifier);
  if (!app) throw new Error(`a app ${identifier} ainda não existe no App Store Connect`);
  const r = await api("GET", `/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=5&include=buildBetaDetail`);
  const details = Object.fromEntries((r.included || []).map((d: any) => [d.id, d.attributes]));
  for (const b of r.data) {
    const d = details[b.relationships?.buildBetaDetail?.data?.id] || {};
    console.log(`${b.attributes.version}\t${b.attributes.processingState}\tinterno: ${d.internalBuildState ?? "?"}\t${b.attributes.uploadedDate}`);
  }
}

async function testers(identifier: string, groupName = "OMS", email?: string) {
  const app = await appFor(identifier);
  if (!app) throw new Error(`a app ${identifier} ainda não existe no App Store Connect`);
  const groups = (await api("GET", `/v1/apps/${app.id}/betaGroups?limit=50`)).data;
  let g = groups.find((x: any) => x.attributes.name === groupName && x.attributes.isInternalGroup);
  if (!g) {
    g = (
      await api("POST", "/v1/betaGroups", {
        data: {
          type: "betaGroups",
          attributes: { name: groupName, isInternalGroup: true, hasAccessToAllBuilds: true },
          relationships: { app: { data: { type: "apps", id: app.id } } },
        },
      })
    ).data;
    console.log(`grupo interno "${groupName}" criado`);
  }
  // O dono da conta (ou o email dado) tem de ser utilizador do App Store Connect.
  const users = (await api("GET", `/v1/users?limit=100`)).data;
  const user = email
    ? users.find((u: any) => u.attributes.username?.toLowerCase() === email.toLowerCase())
    : users.find((u: any) => (u.attributes.roles || []).includes("ACCOUNT_HOLDER")) ?? users[0];
  if (!user) throw new Error("não encontrei o utilizador no App Store Connect");
  const mail = user.attributes.email || user.attributes.username;
  const inGroup = (await api("GET", `/v1/betaGroups/${g.id}/betaTesters?limit=200`)).data;
  if (inGroup.some((t: any) => t.attributes.email?.toLowerCase() === mail.toLowerCase())) {
    console.log(`${user.attributes.firstName} já está no grupo "${groupName}"`);
    return;
  }
  await api("POST", "/v1/betaTesters", {
    data: {
      type: "betaTesters",
      attributes: { email: mail, firstName: user.attributes.firstName, lastName: user.attributes.lastName },
      relationships: { betaGroups: { data: [{ type: "betaGroups", id: g.id }] } },
    },
  });
  console.log(`${user.attributes.firstName} ${user.attributes.lastName} adicionado ao grupo "${groupName}"`);
}

// A ficha da App Store (docs/app-store/listing.json): só escreve na versão que
// está em "Prepare for Submission" e nunca a manda para revisão. Campos sem
// valor (null) ficam como estão no App Store Connect.
async function listing(identifier: string, file: string) {
  const f = JSON.parse(readFileSync(file, "utf8"));
  const app = await appFor(identifier);
  if (!app) throw new Error(`a app ${identifier} ainda não existe no App Store Connect`);
  const clean = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

  const versions = (await api("GET", `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=10`)).data;
  const version = versions.find((v: any) => ["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED"].includes(v.attributes.appStoreState));
  if (!version) throw new Error("não há nenhuma versão em preparação (nada foi mudado)");
  const vAttrs = clean({ versionString: f.versionString, copyright: f.copyright });
  if (Object.keys(vAttrs).length)
    await api("PATCH", `/v1/appStoreVersions/${version.id}`, { data: { type: "appStoreVersions", id: version.id, attributes: vAttrs } });
  console.log(`versão ${f.versionString ?? version.attributes.versionString} (${version.attributes.appStoreState})`);

  const infos = (await api("GET", `/v1/apps/${app.id}/appInfos`)).data;
  const info = infos.find((i: any) => i.attributes.appStoreState !== "READY_FOR_SALE") ?? infos[0];
  if (f.categories) {
    const rel = (id: string | null) => (id ? { data: { type: "appCategories", id } } : undefined);
    await api("PATCH", `/v1/appInfos/${info.id}`, {
      data: { type: "appInfos", id: info.id, relationships: clean({ primaryCategory: rel(f.categories.primary), secondaryCategory: rel(f.categories.secondary) }) },
    });
    console.log(`categorias ${f.categories.primary} / ${f.categories.secondary}`);
  }
  if (f.ageRating) {
    const decl = (await api("GET", `/v1/appInfos/${info.id}/ageRatingDeclaration`)).data;
    await api("PATCH", `/v1/ageRatingDeclarations/${decl.id}`, { data: { type: "ageRatingDeclarations", id: decl.id, attributes: f.ageRating } });
    console.log("classificação etária respondida");
  }

  const infoLocs = (await api("GET", `/v1/appInfos/${info.id}/appInfoLocalizations?limit=50`)).data;
  const verLocs = (await api("GET", `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`)).data;
  for (const [locale, l] of Object.entries<any>(f.locales || {})) {
    const ia = clean({ name: l.name, subtitle: l.subtitle, privacyPolicyUrl: l.privacyPolicyUrl });
    const ii = infoLocs.find((x: any) => x.attributes.locale === locale);
    if (ii) await api("PATCH", `/v1/appInfoLocalizations/${ii.id}`, { data: { type: "appInfoLocalizations", id: ii.id, attributes: ia } });
    else
      await api("POST", "/v1/appInfoLocalizations", {
        data: { type: "appInfoLocalizations", attributes: { locale, ...ia }, relationships: { appInfo: { data: { type: "appInfos", id: info.id } } } },
      });
    const va = clean({
      description: l.description, keywords: l.keywords, supportUrl: l.supportUrl, marketingUrl: l.marketingUrl,
      promotionalText: l.promotionalText, whatsNew: l.whatsNew,
    });
    // Criar a língua na appInfo pode criar também a da versão: ler outra vez.
    const vi = (verLocs.find((x: any) => x.attributes.locale === locale) ??
      (await api("GET", `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`)).data.find(
        (x: any) => x.attributes.locale === locale,
      ));
    if (vi) await api("PATCH", `/v1/appStoreVersionLocalizations/${vi.id}`, { data: { type: "appStoreVersionLocalizations", id: vi.id, attributes: va } });
    else
      await api("POST", "/v1/appStoreVersionLocalizations", {
        data: { type: "appStoreVersionLocalizations", attributes: { locale, ...va }, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } },
      });
    console.log(`textos ${locale}`);
  }

  if (f.review) {
    const notes = Array.isArray(f.review.notes) ? f.review.notes.join("\n") : f.review.notes;
    const ra = clean({
      notes, contactEmail: f.review.contactEmail, contactFirstName: f.review.contactFirstName,
      contactLastName: f.review.contactLastName, contactPhone: f.review.contactPhone,
      demoAccountRequired: f.review.demoAccountRequired, demoAccountName: f.review.demoAccountName,
      // A palavra-passe da conta de demonstração não vai para o git.
      demoAccountPassword: process.env.ASC_DEMO_PASSWORD || f.review.demoAccountPassword,
    });
    const existing = (await api("GET", `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`)).data;
    if (!existing && !ra.contactPhone) {
      console.log("notas para a revisão por pôr: a Apple só as aceita com o telefone de contacto (review.contactPhone)");
    } else if (existing) await api("PATCH", `/v1/appStoreReviewDetails/${existing.id}`, { data: { type: "appStoreReviewDetails", id: existing.id, attributes: ra } });
    else
      await api("POST", "/v1/appStoreReviewDetails", {
        data: { type: "appStoreReviewDetails", attributes: ra, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } },
      });
    if (existing || ra.contactPhone) console.log(`notas para a revisão (${(notes || "").length} caracteres)`);
  }
  console.log("pronto (nada foi submetido)");
}

// Capturas da versão em preparação: apaga as que lá estão nesse tamanho e
// envia as da pasta, pela ordem dos nomes (reserva, partes, confirmação MD5).
async function screenshots(identifier: string, locale: string, displayType: string, dir: string) {
  const app = await appFor(identifier);
  if (!app) throw new Error(`a app ${identifier} ainda não existe no App Store Connect`);
  const versions = (await api("GET", `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=10`)).data;
  const version = versions.find((v: any) => ["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED"].includes(v.attributes.appStoreState));
  if (!version) throw new Error("não há nenhuma versão em preparação");
  const loc = (await api("GET", `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`)).data.find(
    (x: any) => x.attributes.locale === locale,
  );
  if (!loc) throw new Error(`a versão não tem a língua ${locale}`);
  const sets = (await api("GET", `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=50`)).data;
  let set = sets.find((x: any) => x.attributes.screenshotDisplayType === displayType);
  if (!set)
    set = (
      await api("POST", "/v1/appScreenshotSets", {
        data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: displayType }, relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: loc.id } } } },
      })
    ).data;
  for (const old of (await api("GET", `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`)).data)
    await api("DELETE", `/v1/appScreenshots/${old.id}`);
  const files = readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
  for (const name of files) {
    const bytes = readBytes(`${dir}/${name}`);
    const shot = (
      await api("POST", "/v1/appScreenshots", {
        data: { type: "appScreenshots", attributes: { fileName: name, fileSize: bytes.length }, relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } } } },
      })
    ).data;
    for (const op of shot.attributes.uploadOperations) {
      const headers = Object.fromEntries((op.requestHeaders || []).map((h: any) => [h.name, h.value]));
      const res = await fetch(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) as unknown as Blob });
      if (!res.ok) throw new Error(`envio de ${name} falhou: ${res.status}`);
    }
    await api("PATCH", `/v1/appScreenshots/${shot.id}`, {
      data: { type: "appScreenshots", id: shot.id, attributes: { uploaded: true, sourceFileChecksum: new Bun.CryptoHasher("md5").update(bytes).digest("hex") } },
    });
    console.log(`${displayType} ${locale}: ${name}`);
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    if (cmd === "profile") await profile(args[0], args.slice(1));
    else if (cmd === "ensure") await ensure(args[0], args[1], args.slice(2));
    else if (cmd === "app") process.exit((await appFor(args[0])) ? 0 : 1);
    else if (cmd === "builds") await builds(args[0]);
    else if (cmd === "testers") await testers(args[0], args[1], args[2]);
    else if (cmd === "listing") await listing(args[0], args[1]);
    else if (cmd === "screenshots") await screenshots(args[0], args[1], args[2], args[3]);
    else if (cmd === "req") console.log(JSON.stringify(await api(args[0], args[1], args[2]), null, 2));
    else {
      console.error("uso: asc.ts ensure|profile|app|builds|testers|listing|screenshots|req ...");
      process.exit(2);
    }
  } catch (e: any) {
    console.error(e.message);
    process.exit(1);
  }
}

void main();
