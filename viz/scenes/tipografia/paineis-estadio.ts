/**
 * Painéis do estádio: à noite, a bancada em frente com três fitas de LED a
 * dar a volta ao estádio; o título e o artista correm numa, a linha da letra
 * noutra, em sentidos contrários, ponto de luz a ponto de luz. A batida faz
 * piscar os painéis e os holofotes, os agudos acendem telemóveis na
 * bancada, e na queda os painéis entram em festa (cores a varrer, tudo a
 * piscar) com a multidão iluminada.
 */
import { TEXT_HEAD, WIDE, artistOf, textShader, titleOf, upper } from "./_lib";

let fr0 = 1, fr1 = 1, scroll0 = 0, scroll1 = 0, strobe = 0;

export default textShader({
  id: "paineis-estadio",
  name: "Painéis do estádio",
  names: { en: "Stadium boards", lv: "Stadiona tablo" },
  families: ["electronic", "chaos"],
  tags: ["led", "estádio", "noite", "texto", "letra", "festa"],
  intensity: 4,
  cost: 1,
  signals: ["energy", "bass", "high", "beat", "drop", "section", "lyric", "title", "palette"],
  lyrics: "own",
}, TEXT_HEAD + `
// uma fita de LED: y no centro, espessura, curvatura, linha da textura, deslocamento, fracção do padrão
vec3 board(vec2 p, float y0, float th0, float curv, float row, float sc, float frac, float seed, inout float hit){
  float yc = y0 + curv*p.x*p.x;
  float th = th0*(1. + .9*p.x*p.x);
  float v = (p.y - yc)/th + .5;
  if (v < 0. || v > 1.) return vec3(0.);
  hit = 1.;
  float rows = 12.;
  float s = p.x*(1. + .45*p.x*p.x)/th0*rows*.5 + sc;
  vec2 g = vec2(s, v*rows);
  vec2 cell = floor(g);
  vec2 f = fract(g) - .5;
  float colsPat = frac*TR.x/(128./rows);
  float tx = fract((cell.x+.5)/colsPat)*frac;
  float ty = (row*128. + (1. - (cell.y+.5)/rows)*128.)/256.;
  float lit = step(.45, texture(TXT, vec2(tx, ty)).r);
  float party = U0.w;
  vec3 on = mix(vec3(1.,.95,.85), pal(cell.x*.01 + seed + T*.1), .45);
  vec3 bg = pal(cell.x*.004 - T*.3 + v*.2)*party;
  vec3 led = mix(bg*.9, on*(1. - .85*party*step(.5, fract(T*4.))), lit);
  led *= 1. + U0.z*1.2;
  float d = length(f);
  float core = smoothstep(.42,.22,d);
  float halo = smoothstep(.7,.0,d)*.35;
  vec3 c = led*(core + halo) + vec3(.025)*core;
  // a moldura
  c *= smoothstep(0.,.04,v)*smoothstep(1.,.96,v);
  return c*1.3;
}
void main(){
  vec2 u = pixuv(uv);
  vec2 p = (u-.5)*vec2(R.x/R.y,1.);
  float hit = 0.;
  vec3 col = vec3(0.);
  // céu e holofotes
  col += vec3(.01,.012,.03) + vec3(.03,.035,.06)*smoothstep(-.1,.6,p.y);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 lp = vec2(-.75 + fi*.5, .47);
    float l = exp(-length((p - lp)*vec2(1.,1.6))*14.);
    col += vec3(1.,.97,.9)*l*(1.2 + 2.*BEAT*step(.5, hash(vec2(fi, floor(BAR*4.)))));
    col += vec3(.6,.65,.8)*.05*exp(-abs(p.x - lp.x + (p.y-lp.y)*.3*(fi-1.5))*20.)*smoothstep(.5,.0,p.y)*(.3+BEAT);
  }
  // bancadas: multidão às camadas
  float tier = smoothstep(.38, .36, p.y - .05*p.x*p.x);
  vec2 cg = vec2(p.x*90., p.y*70.);
  float head = smoothstep(.5,.2,length(fract(cg + vec2(hash(floor(cg.yy))*.5,0.)) - .5));
  float bob = sin(T*6. + hash(floor(cg))*6.28)*B*.3;
  vec3 crowd = mix(vec3(.02,.02,.03), mix(C1,C2,hash(floor(cg)))*.25, head*(.4+bob))*(.4 + .8*U0.w + .5*E);
  float phone = step(.997 - .01*H, hash(floor(cg) + floor(T*3.)))*head;
  col = mix(col, crowd + phone*vec3(1.,.95,.9)*2., tier);
  // relvado
  float grass = smoothstep(-.33,-.36, p.y + .02*p.x*p.x);
  vec3 gr = vec3(.03,.12,.05)*(1. + .25*step(.5, fract(p.x*6. + p.y*0.))) * (1.+.6*BEAT);
  col = mix(col, gr, grass);
  // as três fitas
  vec3 b1 = board(p, .27, .055, -.09, 0., U0.x, U1.x, .0, hit);
  vec3 b2 = board(p, .08, .07, -.12, 1., U0.y, U1.y, .33, hit);
  vec3 b3 = board(p, -.24, .085, -.05, 0., -U0.x*1.3 + 40., U1.x, .66, hit);
  vec3 b = b1 + b2 + b3;
  col = mix(col, b, step(.001, length(b)) );
  // luz dos painéis na bancada
  col += mix(C2,C3,.5)*.06*(1.+U0.z+U0.w)*tier;
  col *= 1. - .25*dot(p,p);
  o = vec4(post(col, gl_FragCoord.xy), 1.);
}`, {
  size: () => [4096, 256],
  paint(ctx, w, _h, env, lyr) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, 256);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    // o que não cabe na textura: letra mais pequena (até 60 %) e depois corta-se pelas palavras
    const strip = (text: string, sep: string, y: number) => {
      let px = 104;
      ctx.font = `${px}px ${WIDE}`;
      let full = `${text}${sep}`;
      let tw = ctx.measureText(full).width;
      if (tw > w) { px = Math.max(62, Math.floor((104 * w) / tw)); ctx.font = `${px}px ${WIDE}`; tw = ctx.measureText(full).width; }
      const ws = text.split(/\s+/);
      while (tw > w && ws.length > 1) { ws.pop(); full = `${ws.join(" ")}…${sep}`; tw = ctx.measureText(full).width; }
      ctx.fillText(full, 0, y, w);
      return Math.min(w, tw);
    };
    const wa = strip(`${upper(titleOf(env))}  ★  ${upper(artistOf(env))}`, "  ★  ", 66);
    const wb = lyr.real ? strip(upper(lyr.text), "  ●  ", 128 + 66) : strip(`OMS MUSIC  ●  ${upper(titleOf(env))}`, "  ●  ", 128 + 66);
    fr0 = Math.max(0.05, wa / w);
    fr1 = Math.max(0.05, wb / w);
  },
  set(u, _t, s, env, _l, dt) {
    const sp = env.reduceMotion ? 0 : dt * (6 + 10 * s.energy);
    scroll0 += sp; scroll1 -= sp * 1.2;
    strobe = Math.max(strobe * Math.exp(-dt * 8), s.beat);
    u[0] = scroll0; u[1] = scroll1; u[2] = strobe * 0.6;
    u[3] = Math.min(1, s.drop * 1.4 + (s.section === "high" ? 0.6 : 0));
    u[4] = fr0; u[5] = fr1;
  },
});
