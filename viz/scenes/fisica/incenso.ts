/**
 * Incenso: três paus de incenso a largar fios de fumo que sobem e se
 * enrolam (o frame anterior levado por um campo de ruído sem divergência,
 * "curl noise", mais a subida do ar quente). Os graves agitam o ar, cada
 * batida solta uma baforada de um dos paus, a queda é uma rajada que
 * desfaz tudo em remoinhos. O fumo tem as cores da capa.
 */
import { FIS_HEAD, gpuScene, Stepper, type Pair } from "./_lib";

const SIM = FIS_HEAD + `

float pot(vec2 p){ return noise(p*2.2 + vec2(0., -T*.25)) + .5*noise(p*4.7 + vec2(T*.2, -T*.4)); }
vec2 curl(vec2 p){
  float e = .01;
  float a = pot(p + vec2(0,e)), b = pot(p - vec2(0,e)), c = pot(p + vec2(e,0)), d = pot(p - vec2(e,0));
  return vec2(a - b, -(c - d))/(2.*e);
}
void main(){
  float asp = R.x/R.y;
  vec2 p = (uv - .5)*vec2(asp, 1.);
  // o ar: sobe, enrola-se, mexe mais com os graves e na queda
  float turb = smoothstep(-.3, .15, p.y);
  vec2 v = vec2(0., .09 + .04*E) + curl(p*1.6)*(.004 + (.016 + .02*B)*turb + .08*DROP);
  v *= smoothstep(-.5, -.25, p.y)*.85 + .15;
  vec2 q = p - v/60.;
  vec2 pu = q/vec2(asp,1.) + .5;
  vec3 prev = texture(S0, pu).rgb;
  // espalha e desvanece devagar
  vec2 e = 1./SR;
  prev = mix(prev, (texture(S0, pu+vec2(e.x,0)).rgb + texture(S0, pu-vec2(e.x,0)).rgb + texture(S0, pu+vec2(0,e.y)).rgb)/3., .03);
  prev *= .996 - .006*smoothstep(.15, .5, p.y);
  vec3 add = vec3(0.);
  for(int i=0;i<3;i++){
    float x = (float(i)-1.)*.42*min(asp, 1.8)/1.8*1.4;
    vec2 tip = vec2(x + .004*sin(T*1.3 + float(i)*2.), -.28);
    float puff = i == int(mod(floor(BAR*4.), 3.)) ? BEAT : 0.;
    float d = length((p - tip)*vec2(1., .6));
    float src = smoothstep(.005 + .02*puff, .0, d)*(.4 + 2.5*puff);
    add += mix(vivid(pal(float(i)*.33 + T*.01)), vec3(.8), .35)*src*.3;
    // o pau e a brasa
    float stick = smoothstep(.0025, .0, abs(p.x - x))*step(p.y, -.28)*step(-.5, p.y);
    add += vec3(.1,.06,.03)*stick*.06;
    add += vec3(1., .45, .15)*smoothstep(.007, .0, length(p - vec2(x, -.28)))*(.25 + .2*sin(T*3. + float(i)));
  }
  o = vec4(clamp(prev + add, 0., 2.), 1.);
}`;

const SHOW = FIS_HEAD + `
void main(){
  vec2 u = pixuv(uv);
  vec3 sm = texture(S0, u).rgb;
  vec3 bg = mix(vec3(.008,.008,.014), vivid(C1)*.05, smoothstep(-.2, 1., u.y));
  vec3 c = bg + sm*(1. - .4*u.y);
  vec2 q = uv-.5; c *= 1.-.4*dot(q,q);
  o = vec4(post(aces(c*1.2), gl_FragCoord.xy), 1.);
}`;

export default gpuScene({
  id: "incenso",
  name: "Incenso",
  names: { en: "Incense", lv: "Vīraks" },
  families: ["calm"],
  tags: ["fumo", "suave", "meditação", "escuro"],
  intensity: 1,
  cost: 1,
  signals: ["energy", "bass", "beat", "drop", "palette"],
  lyrics: "ink",
}, [SIM, SHOW], (g) => {
  const sim = g.full(SIM), show = g.full(SHOW);
  const st = new Stepper(60, 3, 360);
  let smoke: Pair | null = null;
  return {
    resize(w, h) {
      g.free(smoke);
      smoke = g.pair(Math.max(64, Math.round(w * 0.6)), Math.max(64, Math.round(h * 0.6)), { linear: true });
      st.reset();
    },
    frame(_g, f) {
      if (!smoke) return;
      const n = st.n(f.dt, g.env);
      for (let i = 0; i < n; i++) { g.pass(sim, smoke.write, smoke.read); smoke.swap(); g.tick(); }
      g.pass(show, null, smoke.read);
    },
  };
});
