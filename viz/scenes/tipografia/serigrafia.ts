/**
 * Serigrafia: um cartaz de concerto impresso à frente de quem vê, camada a
 * camada, cada uma puxada pelo rodo num compasso: primeiro o sol em
 * retícula, depois a capa em pontos, por fim o título em letras gordas e a
 * linha da letra. As cores saem desalinhadas como numa impressão à mão; a
 * batida desacerta o registo, os graves engordam os pontos, a queda borra a
 * tinta toda. A cada oito compassos um cartaz novo, noutras cores.
 */
import { barPhase } from "../../lib/beat";
import { SANS, TEXT_HEAD, artistOf, fit, textShader, titleOf, upper, wrapLines } from "./_lib";

export default textShader({
  id: "serigrafia",
  name: "Cartaz serigrafado",
  names: { en: "Screen-printed poster", lv: "Sietspiedes plakāts" },
  families: ["retro", "chaos"],
  tags: ["cartaz", "tinta", "papel", "concerto", "texto", "capa"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "beat", "onset", "bar", "drop", "lyric", "title", "cover", "palette"],
  lyrics: "own",
  artwork: "own",
}, TEXT_HEAD + `
float dots(vec2 p, float cell, float a, float v){
  p = rot(a)*p/cell;
  vec2 f = fract(p)-.5;
  return smoothstep(.04,-.04, length(f) - .72*sqrt(clamp(v,0.,1.)));
}
float wipe(vec2 u, float r){ return step(u.x, r*1.25 - .12 + .1*noise(u*vec2(3.,40.))); }
void main(){
  vec2 u = pixuv(uv);
  vec2 asp = vec2(R.x/R.y,1.);
  vec2 p = (u-.5)*asp;
  float cyc = U0.w;
  vec2 mis = vec2(sin(cyc*3.1), cos(cyc*1.7))*.004 + (BEAT*.006 + ON*.01 + DROP*.03)*vec2(1.,-.6);
  // papel
  vec3 paper = vec3(.95,.92,.85) - fbm(u*R/90.)*.08 - hash(u*R)*.03;
  vec3 col = paper;
  float cell = (.012 + .004*B)*1.;
  // camada 1: o sol em retícula (C1)
  vec2 sc = vec2(mix(-.35,.35,hash(vec2(cyc,1.))), mix(-.1,.25,hash(vec2(cyc,2.))));
  float r = length(p - sc);
  float sun = smoothstep(.42,.41,r);
  float rays = step(.5, fract(atan(p.y-sc.y,p.x-sc.x)/6.2832*18. + T*.01))*smoothstep(1.4,.42,r)*(1.-sun);
  float v1 = sun*(1.-r*1.6) + rays*.55;
  float l1 = dots(p, cell*1.2, .3, v1 + .15*sun) * wipe(u, U0.x);
  col *= mix(vec3(1.), C1*.95, l1*.92);
  // camada 2: a capa em pontos (C2), desalinhada
  vec2 cp = (p + mis)*1.25*vec2(1.,-1.) + .5;
  vec3 cov = texture(COVER, clamp(cp,0.,1.)).rgb;
  float inside = smoothstep(.5,.36,length(cp-.5));
  float lum = 1. - dot(cov, vec3(.3,.55,.15));
  float l2 = dots(p + mis, cell, .78, lum*inside*.95) * wipe(u, U0.y);
  col *= mix(vec3(1.), C2*.9, l2*.88);
  // camada 3: o texto (tinta escura e a cor 3 desalinhada por baixo)
  vec2 tu = vec2(u.x, 1.-u.y);
  vec4 tx = texture(TXT, tu);
  vec4 tx2 = texture(TXT, tu + mis*vec2(1.,-1.)*2.);
  float w3 = wipe(u, U0.z);
  col *= mix(vec3(1.), C3*.85, max(tx2.r, tx2.b)*.9*w3);
  float ink = max(tx.r, max(tx.g, tx.b));
  col *= mix(vec3(1.), vec3(.08,.07,.1), ink*.95*w3);
  // o rodo a passar
  float fr = max(max(U1.x, U1.y), U1.z);
  float front = fr*1.25 - .12;
  col *= 1. - .55*smoothstep(.03,.0,abs(u.x-front))*step(.001,fr)*step(fr,.999);
  // tinta borrada na queda
  col = mix(col, col*mix(vec3(1.),C2,.5), DROP*fbm(p*6.+T)*.8);
  col *= 1. - .3*dot(p,p);
  o = vec4(post(col, gl_FragCoord.xy), 1.);
}`, {
  size: (w, h) => { const a = Math.min(1280, w); return [a, Math.round((a * h) / w)]; },
  dirty: (_e, _l, changed) => changed,
  paint(ctx, w, h, env, lyr) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const title = upper(titleOf(env));
    const m = w * 0.06;
    const font = (px: number) => `900 ${px}px ${SANS}`;
    // o título em pilha, à esquerda, condensado
    ctx.save();
    ctx.scale(0.78, 1);
    ctx.font = font(h * 0.2);
    const lines = wrapLines(ctx, title, (w - m * 2) / 0.78, 4);
    let y = m;
    ctx.textBaseline = "top";
    ctx.fillStyle = "#f00";
    for (const l of lines) {
      const sz = Math.min(h * 0.24, fit(ctx, l, (w - m * 2) / 0.78, font, h * 0.24));
      ctx.font = font(sz);
      ctx.fillText(l, m / 0.78, y);
      y += sz * 0.92;
    }
    ctx.restore();
    // o artista e a linha da letra
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#0f0";
    const art = upper(artistOf(env));
    ctx.font = `800 ${fit(ctx, art, w * 0.5, (px) => `800 ${px}px ${SANS}`, h * 0.07)}px ${SANS}`;
    ctx.fillText(art, m, h - m * 1.9);
    ctx.font = `700 ${Math.round(h * 0.028)}px ${SANS}`;
    ctx.fillText("AO VIVO · ENTRADA LIVRE · OMS MUSIC", m, h - m * 1.1);
    if (lyr.real) {
      ctx.fillStyle = "#00f";
      ctx.textAlign = "right";
      ctx.font = `italic 700 ${Math.round(h * 0.045)}px ${SANS}`;
      const ls = wrapLines(ctx, `«${lyr.text}»`, w * 0.42, 3);
      for (let i = 0; i < ls.length; i++) ctx.fillText(ls[i], w - m, h - m * 1.9 - (ls.length - 1 - i) * h * 0.055);
      ctx.textAlign = "left";
    }
  },
  set(u, _t, s, env) {
    // ciclo de 8 compassos: camada 1, 2, 3 e cinco compassos com o cartaz pronto
    const bar = Math.max(0, s.bar);
    const cyc = Math.floor(bar / 8);
    const b = Math.floor(bar) % 8;
    const ph = env.reduceMotion ? 1 : barPhase(s);
    const ease = (x: number) => 1 - (1 - x) ** 3;
    u[0] = b > 0 || env.reduceMotion ? 1 : ease(ph);
    u[1] = b > 1 || env.reduceMotion ? 1 : b === 1 ? ease(ph) : 0;
    u[2] = b > 2 || env.reduceMotion ? 1 : b === 2 ? ease(ph) : 0;
    u[3] = cyc;
    u[4] = b === 0 && !env.reduceMotion ? ph : 0;
    u[5] = b === 1 && !env.reduceMotion ? ph : 0;
    u[6] = b === 2 && !env.reduceMotion ? ph : 0;
  },
});
