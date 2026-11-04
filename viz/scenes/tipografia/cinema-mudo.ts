/**
 * Cinema mudo: cada linha da letra é um intertítulo de filme antigo, letras
 * brancas com serifa numa moldura art déco, e depois corta para a "cena" (a
 * capa a preto e branco, a tremer no projector). Grão, riscos, pó e o
 * tremeluzir da lâmpada na batida; cada secção abre e fecha em íris, e na
 * queda a película queima-se no meio. Sem letra: "OMS Music apresenta" e o
 * título.
 */
import { SERIF, TEXT_HEAD, artistOf, fit, textShader, titleOf, wrapLines } from "./_lib";

const deco = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
  const m = Math.min(w, h) * 0.07;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = Math.max(2, h * 0.006);
  ctx.strokeRect(m, m, w - m * 2, h - m * 2);
  ctx.lineWidth = Math.max(1, h * 0.002);
  ctx.strokeRect(m * 1.35, m * 1.35, w - m * 2.7, h - m * 2.7);
  // cantos em leque
  for (const [cx, cy, sx, sy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) {
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, m * 0.35 * i, sx > 0 ? (sy > 0 ? 0 : -Math.PI / 2) : sy > 0 ? Math.PI / 2 : Math.PI, (sx > 0 ? (sy > 0 ? 0 : -Math.PI / 2) : sy > 0 ? Math.PI / 2 : Math.PI) + Math.PI / 2);
      ctx.stroke();
    }
  }
  // filetes no meio de cima e de baixo
  for (const y of [m * 1.9, h - m * 1.9]) {
    ctx.beginPath(); ctx.moveTo(w * 0.38, y); ctx.lineTo(w * 0.62, y); ctx.stroke();
    ctx.beginPath(); ctx.arc(w / 2, y, h * 0.008, 0, 6.283); ctx.fillStyle = "#fff"; ctx.fill();
  }
};

export default textShader({
  id: "cinema-mudo",
  name: "Cinema mudo",
  names: { en: "Silent film", lv: "Mēmais kino" },
  families: ["retro"],
  tags: ["cinema", "antigo", "preto e branco", "texto", "letra", "capa"],
  intensity: 2,
  cost: 1,
  signals: ["beat", "onset", "drop", "section", "lyric", "title", "cover"],
  lyrics: "own",
  artwork: "own",
}, TEXT_HEAD + `
void main(){
  vec2 u = pixuv(uv);
  float fr = floor(T*18.);
  // o projector: a imagem a dançar e a rolar de vez em quando
  vec2 weave = vec2(hash(vec2(fr,1.))-.5, hash(vec2(fr,2.))-.5)*.004;
  float roll = ON*.08*step(.7, hash(vec2(fr,5.)));
  vec2 w = u + weave + vec2(0., roll);
  w.y = fract(w.y);
  vec2 p = (w-.5)*vec2(R.x/R.y,1.);
  // a cena: a capa num quadro 4:3, a preto e branco, devagar a aproximar
  vec2 cu = p*vec2(.75,-1.)/(1.02 + .1*fract(SECAGE*.03)) + .5;
  vec3 cv = texture(COVER, cu).rgb;
  float l = dot(cv, vec3(.3,.59,.11));
  l = smoothstep(.05,.95,l);
  float scene = l*step(abs(p.x), .667);
  // o intertítulo
  vec2 tu = vec2(w.x, 1.-w.y);
  float card = texture(TXT, tu).r;
  float img = mix(scene, card*.92 + .03, U0.y);
  // íris nas mudanças de secção
  float ir = U0.x;
  float iris = smoothstep(ir, ir - .02, length(p));
  img *= iris;
  // queimadura na queda
  float burnR = DROP*DROP*.7;
  float bn = length(p*vec2(1.,1.2)) + fbm(p*5. + T)*.15;
  float hole = smoothstep(burnR, burnR - .03, bn);
  float rim = smoothstep(burnR + .05, burnR, bn) - hole;
  // grão, pó, riscos, tremeluzir
  float grain = (hash(gl_FragCoord.xy*.7 + fr) - .5)*.16;
  float dust = step(.9985, hash(floor(gl_FragCoord.xy/3.) + fr*7.))*-.6;
  float sx = hash(vec2(fr, 9.));
  float scratch = smoothstep(.0015,.0,abs(u.x - sx))*step(.6, hash(vec2(fr,11.)))*.35;
  float flick = .88 + .1*hash(vec2(fr, 3.)) + .12*BEAT;
  float v = (img + grain + dust + scratch)*flick;
  v *= 1. - .55*pow(length((u-.5)*vec2(1.1,1.)), 2.2)*2.;
  vec3 sepia = mix(vec3(v), v*vec3(1.08,.98,.82), .65);
  sepia = mix(sepia, vec3(1.,.55,.15)*1.6, rim);
  sepia = mix(sepia, vec3(1.), hole);
  // a linha da moldura do fotograma ao rolar
  sepia *= 1. - step(abs(fract(u.y + roll) - .0), .004)*step(.001, roll);
  o = vec4(post(sepia, gl_FragCoord.xy), 1.);
}`, {
  size: (w, h) => { const a = Math.min(1280, w); return [a, Math.round((a * h) / w)]; },
  paint(ctx, w, h, env, lyr) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    deco(ctx, w, h);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const font = (px: number) => `italic ${px}px ${SERIF}`;
    if (lyr.real) {
      ctx.font = font(h * 0.09);
      const lines = wrapLines(ctx, lyr.text, w * 0.66, 4);
      let size = h * 0.11;
      for (const l of lines) size = Math.min(size, fit(ctx, l, w * 0.66, font, h * 0.11));
      ctx.font = font(size);
      for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.3);
    } else {
      ctx.font = `${Math.round(h * 0.035)}px ${SERIF}`;
      ctx.fillText("OMS MUSIC APRESENTA", w / 2, h * 0.3);
      const t = titleOf(env);
      ctx.font = font(h * 0.1);
      const lines = wrapLines(ctx, t, w * 0.66, 3);
      let size = h * 0.13;
      for (const l of lines) size = Math.min(size, fit(ctx, l, w * 0.66, font, h * 0.13));
      ctx.font = font(size);
      for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], w / 2, h * 0.5 + (i - (lines.length - 1) / 2) * size * 1.2);
      ctx.font = `${Math.round(h * 0.04)}px ${SERIF}`;
      ctx.fillText(`com ${artistOf(env)}`, w / 2, h * 0.72, w * 0.6);
    }
  },
  set(u, t, s, env, lyr) {
    // o intertítulo fica uns 2 s depois de cada linha; depois corta para a cena
    const dur = Math.max(1.6, Math.min(2.6, lyr.ends[Math.max(0, lyr.n - 1)] - lyr.t0));
    u[1] = env.reduceMotion || !env.coverTex || t < lyr.t0 + dur ? 1 : 0;
    // íris: fecha no fim da secção, abre no início
    const a = s.sectionAge;
    u[0] = env.reduceMotion ? 2 : a < 1.2 ? 0.05 + (a / 1.2) * 1.6 : 2;
  },
});
