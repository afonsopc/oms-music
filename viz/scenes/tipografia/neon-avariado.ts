/**
 * Néon avariado: o título num letreiro de tubos de néon numa parede de
 * tijolo, cada letra com o seu tubo. Umas letras estão gastas e piscam, os
 * ataques fazem falhar letras ao acaso, a batida dá um zumbido de corrente,
 * nas calmas o letreiro quase se apaga e na queda acende-se tudo de uma vez
 * a brilhar. O artista em tubo fino por baixo.
 */
import { TEXT_HEAD, WIDE, artistOf, fit, textShader, titleOf, units, wrapLines } from "./_lib";

type Glyph = { ch: string; x: number; y: number; size: number; id: number };

const layout = (ctx: CanvasRenderingContext2D, w: number, h: number, title: string, artist: string): Glyph[] => {
  const out: Glyph[] = [];
  const font = (px: number) => `${px}px ${WIDE}`;
  let size = fit(ctx, title, w * 0.84, font, h * 0.26);
  let lines = [title];
  if (size < h * 0.12 && /\s/.test(title)) {
    ctx.font = font(h * 0.13);
    lines = wrapLines(ctx, title, w * 0.84, 3);
    size = h * 0.2;
    for (const l of lines) size = Math.min(size, fit(ctx, l, w * 0.84, font, h * 0.2));
  }
  const aSize = Math.max(10, Math.min(size * 0.38, fit(ctx, artist, w * 0.6, font, h * 0.07)));
  const total = lines.length * size * 1.15 + aSize * 1.8;
  let y = h / 2 - total / 2 + size * 0.6;
  let id = 1;
  const put = (line: string, sz: number, yy: number) => {
    ctx.font = font(sz);
    const us = units(line);
    let tw = 0;
    const ws = us.map((u) => { const m = ctx.measureText(u).width; tw += m; return m; });
    let x = w / 2 - tw / 2;
    us.forEach((u, i) => {
      if (u.trim()) out.push({ ch: u, x, y: yy, size: sz, id: id++ });
      x += ws[i];
    });
  };
  for (const l of lines) { put(l, size, y); y += size * 1.15; }
  put(artist, aSize, y + aSize * 0.5);
  return out;
};

export default textShader({
  id: "neon-avariado",
  name: "Néon avariado",
  names: { en: "Broken neon", lv: "Salūzis neons" },
  families: ["retro", "electronic"],
  tags: ["néon", "texto", "noite", "cidade", "título"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "beat", "onset", "drop", "section", "title", "palette"],
  lyrics: "ink",
}, TEXT_HEAD + `
float brick(vec2 p){
  p.x += step(1., mod(floor(p.y),2.))*.5;
  vec2 f = fract(p);
  float m = smoothstep(.0,.06,f.x)*smoothstep(1.,.94,f.x)*smoothstep(.0,.1,f.y)*smoothstep(1.,.9,f.y);
  return m*(.75+.25*hash(floor(p)));
}
vec3 neon(float id){ vec3 c = pal(hash(vec2(id*.37, 1.3))*.999 + floor(U0.x)*.13); float l = max(c.r,max(c.g,c.b)); c = c/max(l,.05); return mix(c, vec3(1.), .12); }
float state(float id){
  float seed = hash(vec2(id, 3.7));
  float broken = step(.72, seed);
  float buzz = step(.3, noise(vec2(T*(6.+seed*18.), id*7.)));
  float f = mix(1., buzz, broken);
  f *= 1. - ON*step(.55, hash(vec2(id, floor(T*5.))));
  f *= mix(1., step(.45, noise(vec2(T*2.5, id))), U0.y);
  return mix(f, 1., clamp(DROP*1.5,0.,1.));
}
void main(){
  vec2 u = pixuv(uv);
  vec2 c = u - .5;
  c *= 1. - .015*BEAT;
  vec2 tu = vec2(c.x+.5, .5-c.y);
  vec4 tx = texture(TXT, tu);
  vec2 px = 1./TR;
  float g2 = texture(TXT, tu+vec2(9.,0.)*px).g + texture(TXT, tu-vec2(9.,0.)*px).g + texture(TXT, tu+vec2(0.,9.)*px).g + texture(TXT, tu-vec2(0.,9.)*px).g;
  float id = floor(tx.b*255./6.+.5);
  float on = id > .5 ? state(id) : 0.;
  float hum = .92 + .08*sin(T*100.+id*3.) + .25*BEAT;
  float lvl = on*hum*(.55 + .35*E + .4*DROP + .2*SEC);
  vec3 col = neon(id);
  // parede: tijolo escuro iluminado pelo letreiro
  vec2 bp = gl_FragCoord.xy/R.y*vec2(7.,15.);
  float b = brick(bp);
  float grime = fbm(bp*.7);
  vec3 wall = vec3(.16,.09,.08)*b*(.55+.6*grime);
  float halo = tx.g*.5 + g2*.12;
  float glob = (.4 + .3*E + .4*DROP)*(1. - .4*U0.y);
  vec3 light = mix(neon(1.), neon(2.), .5)*halo*glob;
  vec3 core = col*tx.g*tx.g*lvl;
  vec3 amb = mix(C1,C2,.5)*(.05+.12*E*U0.z);
  vec3 o3 = wall*(.12 + amb*3. + light*2.2) + light*.5 + core*1.6;
  // o tubo: aceso brilha quase branco, apagado é vidro baço
  float tube = tx.r;
  o3 += tube*(lvl*mix(col, vec3(1.), .55)*2.2 + vec3(.05,.04,.05)*(1.-lvl));
  o3 += col*DROP*.08;
  o3 = 1. - exp(-o3*1.4);
  o3 *= 1. - .35*dot(c,c)*2.;
  o = vec4(post(o3, gl_FragCoord.xy), 1.);
}`, {
  size: (w, h) => { const a = Math.min(1280, w); return [a, Math.round((a * h) / w)]; },
  dirty: (_env, _l, _c) => false,
  paint(ctx, w, h, env) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const gs = layout(ctx, w, h, titleOf(env), artistOf(env));
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    // azul: o número da letra numa mancha à volta dela (para o halo saber de quem é)
    ctx.globalCompositeOperation = "lighten";
    for (const g of gs) {
      ctx.font = `${g.size}px ${WIDE}`;
      ctx.strokeStyle = ctx.fillStyle = `rgb(0,0,${Math.min(255, (g.id % 42) * 6)})`;
      ctx.lineWidth = g.size * 0.7;
      ctx.strokeText(g.ch, g.x, g.y);
      ctx.fillText(g.ch, g.x, g.y);
    }
    // verde: o brilho (desfocado)
    ctx.globalCompositeOperation = "lighter";
    for (const blur of [0.05, 0.16]) {
      ctx.filter = `blur(${Math.round(blur * gs[0].size)}px)`;
      for (const g of gs) {
        ctx.font = `${g.size}px ${WIDE}`;
        ctx.strokeStyle = "rgb(0,150,0)";
        ctx.lineWidth = g.size * 0.07;
        ctx.strokeText(g.ch, g.x, g.y);
      }
    }
    ctx.filter = "none";
    // vermelho: o tubo
    for (const g of gs) {
      ctx.font = `${g.size}px ${WIDE}`;
      ctx.strokeStyle = "rgb(255,0,0)";
      ctx.lineWidth = Math.max(1.5, g.size * 0.035);
      ctx.strokeText(g.ch, g.x, g.y);
    }
    ctx.globalCompositeOperation = "source-over";
  },
  set(u, _t, s) {
    u[0] = s.sectionGroup < 0 ? 0 : s.sectionGroup;
    u[1] = s.section === "intro" || s.section === "breakdown" || s.section === "outro" ? 0.6 : 0;
    u[2] = s.sectionIntensity;
  },
});
