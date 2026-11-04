/**
 * Jogo da vida (Conway) na GPU, ao compasso: uma geração por colcheia
 * (semicolcheia nos refrões). As células nascem brancas e envelhecem pelas
 * cores da capa, deixando rasto. Os graves semeiam sopa nova, a queda
 * carimba a capa na grelha (e ela desfaz-se em vida), cada linha da letra
 * entra escrita em células.
 */
import { FIS_HEAD, gpuScene, type Pair } from "./_lib";
import { BeatEdge, isPeak, SectionEdge } from "../../lib/beat";
import { WIDE } from "../../lib/text";

const SIM = FIS_HEAD + `
int alive(ivec2 c, ivec2 n){ return texelFetch(S0, (c+n) % n, 0).r > .5 ? 1 : 0; }
void main(){
  ivec2 n = ivec2(SR), c = ivec2(gl_FragCoord.xy) + n;
  vec4 s = texelFetch(S0, c % n, 0);
  int k = alive(c+ivec2(-1,-1),n)+alive(c+ivec2(0,-1),n)+alive(c+ivec2(1,-1),n)
        + alive(c+ivec2(-1,0),n)+alive(c+ivec2(1,0),n)
        + alive(c+ivec2(-1,1),n)+alive(c+ivec2(0,1),n)+alive(c+ivec2(1,1),n);
  bool was = s.r > .5;
  bool now = k == 3 || (was && k == 2);
  vec2 u = (gl_FragCoord.xy)/SR;
  // sopa nos graves
  vec4 g = P[1];
  if(g.w > 0. && length((u-g.xy)*vec2(SR.x/SR.y,1.)) < g.z) now = hash(gl_FragCoord.xy + STEP) < .38;
  // a capa (na queda) e a letra
  if(P[2].x > 0.){
    float a = SR.x/SR.y;
    vec2 cu = (u-.5)*vec2(a,1.)*1.25+.5;
    if(cu.x>0. && cu.x<1. && cu.y>0. && cu.y<1.){
      float l = lum(texture(COVER, vec2(cu.x,1.-cu.y)).rgb);
      now = l > .25 + .5*hash(gl_FragCoord.xy*1.3);
    }
  }
  if(P[2].y > 0. && texture(S1, vec2(u.x, 1.-u.y)).a > .5) now = true;
  float age = now ? (was ? min(s.g + 1./40., 1.) : 0.) : 0.;
  float trail = now ? 1. : s.b*.86;
  o = vec4(now ? 1. : 0., age, trail, 1.);
}`;

const SHOW = FIS_HEAD + `
void main(){
  vec2 u = pixuv(uv);
  vec2 g = u*P[4].xy;
  ivec2 ci = ivec2(g);
  vec4 s = texelFetch(S0, ci, 0);
  vec2 f = fract(g)-.5;
  float m = .38 - .06*BEAT;
  vec2 q = abs(f) - m + .12;
  float box = smoothstep(.05,-.05, length(max(q,0.)) - .12);
  vec3 born = vec3(1.);
  vec3 col = mix(born, vivid(pal(s.g*1.3 + u.x*.3 + T*.01)), smoothstep(0.,.12,s.g));
  vec3 c = vivid(C1)*.04;
  c += col*s.r*box*(1. + .6*BEAT);
  c += vivid(pal(.5 + u.y*.4 + T*.01))*s.b*(1.-s.r)*box*.28;
  // brilho: a grelha esbatida à volta
  vec2 px = 1./P[4].xy;
  float glow = 0.;
  glow += texture(S1, u).b + texture(S1, u+vec2(px.x*2.,0)).b + texture(S1, u-vec2(px.x*2.,0)).b + texture(S1, u+vec2(0,px.y*2.)).b + texture(S1, u-vec2(0,px.y*2.)).b;
  c += vivid(C2)*glow*.06*(1.+2.*B);
  vec2 p = uv-.5; c *= 1.-.5*dot(p,p);
  c += DROP*DROP*.3*vivid(C3);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;

export default gpuScene({
  id: "vida",
  name: "Jogo da vida",
  names: { en: "Game of Life", lv: "Dzīves spēle" },
  families: ["retro", "chaos"],
  tags: ["autómato", "píxeis", "simulação", "capa", "letra"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "beat", "bar", "drop", "section", "palette", "cover", "lyric"],
  lyrics: "glitch",
}, [SIM, SHOW], (g) => {
  const sim = g.full(SIM), show = g.full(SHOW);
  const beat = new BeatEdge(1), sec = new SectionEdge();
  const text = document.createElement("canvas");
  const tctx = text.getContext("2d")!;
  const ttex = g.texture();
  let field: Pair | null = null;
  let gw = 1, gh = 1, lastGen = -1, lastLyric = "", cover = true, lyricOn = false, warm = 0;

  const stampText = (line: string) => {
    text.width = gw; text.height = gh;
    tctx.clearRect(0, 0, gw, gh);
    tctx.fillStyle = "#fff";
    tctx.textAlign = "center";
    tctx.textBaseline = "middle";
    let size = Math.round(gh * 0.16);
    tctx.font = `700 ${size}px ${WIDE}`;
    const wd = tctx.measureText(line).width;
    if (wd > gw * 0.9) { size = Math.max(6, Math.floor(size * gw * 0.9 / wd)); tctx.font = `700 ${size}px ${WIDE}`; }
    tctx.fillText(line, gw / 2, gh * 0.5);
    g.upload(ttex, text);
  };

  return {
    resize(w, h) {
      g.free(field);
      const cell = Math.max(4, Math.round(Math.min(w, h) / 100));
      gw = Math.max(16, Math.floor(w / cell)); gh = Math.max(16, Math.floor(h / cell));
      field = g.pair(gw, gh, { fmt: "u8", linear: true, repeat: true });
      cover = true;
      warm = 0;
    },
    song() { cover = true; lastLyric = ""; },
    frame(_g, f) {
      if (!field) return;
      const s = g.s, P = g.P, env = g.env;
      P.fill(0);
      P[16] = gw; P[17] = gh;
      if (sec.hit(s) && sec.big) cover = true;
      if (beat.hit(s) && s.bass > 0.35) { P[4] = Math.random(); P[5] = Math.random(); P[6] = 0.05 + 0.12 * s.bass; P[7] = 1; }
      const line = env.lyric;
      if (line && line !== lastLyric) { stampText(line); lyricOn = true; }
      lastLyric = line;
      // uma geração por colcheia; semicolcheia nos refrões e quedas; com movimento reduzido, 60 gerações de uma vez
      const rate = isPeak(s) || s.drop > 0.2 ? 4 : 2;
      const gen = Math.floor(s.beatPos * rate);
      let n = lastGen < 0 ? 1 : Math.min(3, Math.max(0, gen - lastGen));
      if (gen < lastGen) n = 1;
      lastGen = gen;
      if (env.reduceMotion) n = warm++ === 0 ? 60 : 0;
      if (cover) n = Math.max(n, 1);
      for (let i = 0; i < n; i++) {
        if (cover) P[8] = 1;
        if (lyricOn) P[9] = 1;
        g.pass(sim, field.write, field.read, ttex);
        field.swap();
        g.tick();
        cover = false; lyricOn = false;
        P[7] = 0; P[8] = 0; P[9] = 0;
      }
      g.pass(show, null, field.read, field.read);
    },
  };
});
