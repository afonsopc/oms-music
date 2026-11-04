/**
 * Letras derretidas: o título em cromado líquido que vai derretendo ao longo
 * da secção, a escorrer em fios para uma poça espelhada no chão. Os graves
 * fazem-no ondular e escorrer mais depressa, a batida acende os reflexos,
 * e na queda volta a solidificar de um golpe (com uma onda de choque) para
 * começar a derreter outra vez.
 */
import { TEXT_HEAD, WIDE, artistOf, fit, textShader, titleOf, wrapLines } from "./_lib";

let melt = 0, lastSec = -9;

export default textShader({
  id: "letras-derretidas",
  name: "Letras derretidas",
  names: { en: "Melting letters", lv: "Kūstošie burti" },
  families: ["chaos", "electronic"],
  tags: ["cromado", "líquido", "título", "3d", "metal"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "title", "palette"],
  lyrics: "extrude",
}, TEXT_HEAD + `
float hgt(vec2 q){ return texture(TXT, q).g; }
void main(){
  vec2 u = pixuv(uv);
  vec2 tu = vec2(u.x, 1.-u.y);
  float m = U0.x;
  // ondular e escorrer
  tu.x += sin(tu.y*18. + T*2.)*.0015*m*(1.+B);
  float col = floor(tu.x*TR.x/5.);
  float n = noise(vec2(col*.37, U0.y));
  float d = m*(.01 + .22*pow(n, 3.))*(1. + .3*B);
  float h = 0., mask = 0.;
  for (int i = 0; i < 6; i++) {
    float k = float(i)/5.;
    vec2 q = tu - vec2(0., d*k);
    float r = texture(TXT, q).r;
    if (r > mask) { mask = r; h = hgt(q)*(1. - k*.4); }
  }
  // normal pelo relevo (G desfocado)
  vec2 e = vec2(1.5/TR.x, 0.);
  vec2 q0 = tu - vec2(0., d*.5);
  vec3 nn = normalize(vec3(hgt(q0 - e.xy) - hgt(q0 + e.xy), hgt(q0 - e.yx) - hgt(q0 + e.yx), .06 + .02*m));
  vec3 rd = reflect(vec3(0.,0.,-1.), nn);
  // o "céu" cromado: degradê das cores da capa com um horizonte vivo
  float y = rd.y + .15*sin(rd.x*3. + T*.3);
  vec3 sky = mix(C1*.8, vec3(1.), smoothstep(-.05,.4,y));
  sky = mix(sky, C3*.6, smoothstep(.4,1.,y));
  vec3 ground = mix(vec3(.05,.03,.08), C2*.7, smoothstep(-1.,-.05,y));
  vec3 env = y > 0. ? sky : ground;
  env += smoothstep(.02,.0,abs(y))*vec3(1.)*(.6+.8*BEAT);
  float spec = pow(max(0., dot(rd, normalize(vec3(.4,.6,.7)))), 40.)*(1.5 + 3.*BEAT);
  vec3 chrome = env*(.7 + .3*h) + spec;
  // fundo e poça
  vec2 p = (u-.5)*vec2(R.x/R.y,1.);
  vec3 bg = mix(vec3(.02,.015,.04), C3*.15, smoothstep(.6,-.4,p.y));
  float level = .08 + .12*m;
  float pud = smoothstep(level, level - .01, u.y + .01*sin(u.x*30. + T*2.)*m);
  vec2 ru = vec2(tu.x, 1. - (2.*level - u.y) );
  float refl = texture(TXT, vec2(ru.x, 1.-ru.y)).r;
  vec3 pool = mix(bg*.6, chrome*.5, refl*.6) + env*.08;
  vec3 c = mix(bg, pool, pud*(.4 + .6*m));
  c = mix(c, chrome, mask);
  // a onda de choque da queda
  float ring = smoothstep(.03,.0,abs(length(p) - (1.-DROP)*1.2))*DROP;
  c += ring*C2*1.5;
  c *= 1. - .3*dot(p,p);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`, {
  size: (w, h) => { const a = Math.min(1280, w); return [a, Math.round((a * h) / w)]; },
  dirty: () => false,
  paint(ctx, w, h, env) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const title = titleOf(env);
    const font = (px: number) => `${px}px ${WIDE}`;
    let size = fit(ctx, title, w * 0.84, font, h * 0.3);
    let lines = [title];
    if (size < h * 0.13 && /\s/.test(title)) {
      ctx.font = font(h * 0.15);
      lines = wrapLines(ctx, title, w * 0.84, 3);
      size = h * 0.24;
      for (const l of lines) size = Math.min(size, fit(ctx, l, w * 0.84, font, h * 0.24));
    }
    const art = artistOf(env);
    const as = Math.min(size * 0.4, fit(ctx, art, w * 0.6, font, h * 0.08));
    const top = h * 0.36 - ((lines.length - 1) * size * 1.05) / 2;
    const draw = (color: string) => {
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = font(size);
      for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], w / 2, top + i * size * 1.05);
      ctx.font = font(as);
      ctx.fillText(art, w / 2, top + lines.length * size * 1.05 + as * 0.4);
    };
    ctx.globalCompositeOperation = "lighter";
    ctx.filter = `blur(${Math.max(2, Math.round(size * 0.07))}px)`;
    draw("#0f0");
    ctx.filter = "none";
    draw("#f00");
    ctx.globalCompositeOperation = "source-over";
  },
  set(u, _t, s, env, _l, dt) {
    if (s.sectionIndex !== lastSec) { lastSec = s.sectionIndex; melt = 0; }
    if (s.drop > 0.9) melt = 0;
    melt = env.reduceMotion ? 0.3 : Math.min(1, melt + dt * (0.012 + 0.03 * s.bass + 0.02 * s.energy));
    u[0] = melt;
    u[1] = Math.max(0, s.sectionIndex) * 3.7;
  },
});
