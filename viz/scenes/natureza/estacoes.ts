/**
 * Quatro estações: uma árvore sozinha num monte, e a música inteira a
 * passar por um ano. Cada secção nova avança uma estação: flores na
 * Primavera, copa cheia no Verão, folhas a cair no Outono, ramos nus e
 * neve no Inverno. A copa abana com os graves, a batida solta pétalas,
 * folhas ou flocos, e nas quedas uma rajada sacode a árvore toda.
 */
import { BeatEdge, Envelope, SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

export default natShader({
  id: "estacoes",
  name: "Quatro estações",
  names: { en: "Four seasons", lv: "Četri gadalaiki" },
  families: ["calm"],
  tags: ["natureza", "árvore", "suave", "acústico", "primavera", "outono", "inverno"],
  intensity: 2,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "palette"],
  lyrics: "ink",
}, NAT_GLSL + `
float treeD(vec2 p, float sway, out float tips){
  vec2 base = vec2(0., -.3);
  float d = sd_seg(p, base, vec2(0., -.08)) - .022 + .01*(p.y + .3);
  vec2 q = p - vec2(0., -.08);
  float w = .016, len = .15;
  tips = 1e3;
  for(int i=0;i<7;i++){
    float fi = float(i);
    q.x = abs(q.x);
    q = rot(-(.42 + .06*sin(fi*1.7)) + sway*(.3 + fi*.12))*q;
    d = min(d, sd_seg(q, vec2(0.), vec2(0., len)) - w);
    q.y -= len;
    len *= .76; w *= .68;
  }
  tips = length(q);
  return d;
}
void main(){
  vec2 p = (pixuv(uv) - .5)*vec2(R.x/R.y, 1.);
  float season = U[0].x, sway = U[0].y, fall = U[0].z, burst = U[0].w;
  // pesos das estações: 0 Primavera, 1 Verão, 2 Outono, 3 Inverno
  float s4 = mod(season, 4.);
  vec4 wt = vec4(0.);
  for(int i=0;i<4;i++){ float d = abs(s4 - float(i)); d = min(d, 4. - d); wt[i] = smoothstep(1., 0., d); }
  wt /= max(wt.x + wt.y + wt.z + wt.w, .001);
  vec3 skyS = mix(vec3(.65,.8,.95), vivid(C2), .35), skyU = mix(vec3(.3,.55,.95), vivid(C3), .3);
  vec3 skyA = mix(vec3(.95,.65,.35), vivid(C1), .4), skyW = mix(vec3(.6,.65,.75), vivid(C3)*.6, .3);
  vec3 sky = skyS*wt.x + skyU*wt.y + skyA*wt.z + skyW*wt.w;
  vec3 col = mix(sky*1.05, sky*.45, smoothstep(-.2, .6, p.y));
  vec3 sunC = mix(vec3(1., .9, .7), vivid(C2), .3);
  col += sunC*(.35*exp(-length(p - vec2(.55, .3))*4.))*(1. - .6*wt.w);
  // monte
  float hill = -.3 - .25*p.x*p.x + .01*sin(p.x*20.);
  vec3 gS = mix(vec3(.35,.6,.25), vivid(C1), .3), gU = mix(vec3(.3,.5,.15), vivid(C1), .25);
  vec3 gA = mix(vec3(.55,.3,.1), vivid(C1), .35), gW = vec3(.9,.93,1.);
  vec3 gc = gS*wt.x + gU*wt.y + gA*wt.z + gW*wt.w;
  float tips;
  float bend = sway*.06;
  vec2 tp = p;
  tp.x -= bend*max(0., p.y + .1)*max(0., p.y + .1)*2.;
  float td = treeD(tp, sway*.15, tips);
  // copa: manchas à volta das pontas dos ramos
  vec2 cq = tp - vec2(0., .14);
  float crownR = length(cq*vec2(.85, 1.15));
  float cn = fbm(tp*9. + vec2(sway, 0.));
  float leaf = smoothstep(.36, .32, crownR + (.5 - cn)*.25);
  float dens = .7*wt.x + 1.*wt.y + .75*wt.z;
  float lm = leaf*smoothstep(1. - dens, 1.05 - dens + .1, cn + .2);
  vec3 lS = mix(vec3(1., .75, .85), vivid(C2), .4), lU = mix(vec3(.2,.5,.15), vivid(C1)*.6, .3);
  vec3 lA = mix(vec3(.9,.4,.1), vivid(C1), .35);
  vec3 lc = (lS*wt.x + lU*wt.y + lA*wt.z)/max(wt.x + wt.y + wt.z, .01);
  lc *= .7 + .5*fbm(tp*20.);
  col = mix(col, gc*(.8 + .2*noise(p*30.)), smoothstep(.003, -.003, p.y - hill));
  vec3 bark = vec3(.12,.08,.06)*(1. - .4*wt.w) + vivid(C3)*.02;
  col = mix(col, bark, smoothstep(.003, -.002, td));
  // neve nos ramos no Inverno
  float snowOn = smoothstep(.003, -.001, td)*smoothstep(.35, .7, noise(tp*90.))*wt.w*step(-.08, tp.y);
  col = mix(col, vec3(.93,.95,1.), snowOn*.85);
  col = mix(col, lc, lm*(1. - wt.w*.9));
  // o que cai: pétalas, folhas, flocos
  for(int l=0;l<2;l++){
    float fl = float(l);
    vec2 q = p*(8. - fl*3.) + vec2(fall*(.4 + fl*.3) + fl*5., fall*(1. + fl*.4));
    vec2 id = floor(q), f = fract(q) - .5;
    vec2 h = hash2(id + fl*7.);
    float dens2 = .15 + .35*burst + .25*wt.w + .15*wt.z;
    if(h.x > dens2) continue;
    f -= (h - .5)*.5;
    f = rot(fall*3.*(h.y - .5) + h.x*6.)*f;
    float pd = wt.w > .5 ? length(f) - .05 : length(f*vec2(1., 2.2)) - .09;
    vec3 pc = wt.w > .5 ? vec3(.95,.97,1.) : wt.z > wt.x ? lA*(.8 + .4*h.y) : lS;
    col = mix(col, pc, smoothstep(.01, -.01, pd)*(1. - wt.y*.85));
  }
  col *= 1. - .28*dot(p, p);
  o = vec4(post(aces(col*1.05), gl_FragCoord.xy), 1.);
}`, {
  state: () => {
    const beat = new BeatEdge();
    const sec = new SectionEdge();
    const burst = new Envelope(0.05, 1.2);
    let season = 0, target = 0, pos = 0, vel = 0, fall = 0, first = true;
    return (u, t, s, dt) => {
      if (first) { first = false; target = season = Math.max(0, s.sectionIndex); }
      if (sec.hit(s)) { target = Math.max(target + 1, s.sectionIndex); if (sec.big) { vel += 2.5; burst.kick(1); } }
      if (beat.hit(s)) { vel += 0.4 + 0.8 * s.bass; burst.kick(0.4 * s.sectionIntensity); }
      season += (target - season) * Math.min(1, dt * 0.6);
      const force = 0.3 * s.bass + 0.2 * Math.sin(t * 0.5);
      vel += ((force - pos) * 10 - vel * 2.5) * dt;
      pos += vel * dt;
      burst.step(0, dt);
      fall += dt * (0.25 + 0.6 * burst.v);
      u[0] = season; u[1] = pos; u[2] = fall; u[3] = burst.v;
    };
  },
});
