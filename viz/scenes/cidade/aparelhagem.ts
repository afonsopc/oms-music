/**
 * Aparelhagem dos anos 90: o painel da torre com o analisador de espectro
 * no ecrã fluorescente (24 barras com o pico a cair devagar), os números de
 * sete segmentos com o andamento e o tempo, o botão do volume com o anel de
 * luzes, as grelhas das colunas a bombar. Na queda entra o "modo
 * demonstração" das montras.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "aparelhagem",
  name: "Aparelhagem",
  names: { en: "90s hi-fi" },
  families: ["electronic", "retro"],
  tags: ["anos-90", "equalizador", "som", "espectro"],
  intensity: 3,
  cost: 1,
  signals: ["energy", "bass", "lowmid", "mid", "high", "beat", "drop", "section", "palette"],
  lyrics: "extrude",
}, CITY + `
float lvl(float i, float t){
  float f = i/23.*3.;
  float b = f < 1. ? mix(B, LM, f) : f < 2. ? mix(LM, M, f - 1.) : mix(M, H, f - 2.);
  float v = b*(.55 + .55*noise(vec2(i*.9, t*7.))) + .1*kick()*step(i, 5.);
  float demo = .5 + .45*sin(i*.45 - t*9.)*cos(t*2.3 + i*.1);
  return clamp(mix(v, demo, clamp(DROP*1.3, 0., 1.)), 0., 1.);
}
float seg7(vec2 q, int d){
  int m = d == 0 ? 63 : d == 1 ? 6 : d == 2 ? 91 : d == 3 ? 79 : d == 4 ? 102 : d == 5 ? 109 : d == 6 ? 125 : d == 7 ? 7 : d == 8 ? 127 : 111;
  float r = 0.;
  q.x -= q.y*.12;
  vec2 hs = vec2(.3, .07), vs = vec2(.07, .38);
  if((m & 1) != 0) r = max(r, step(sdBox(q - vec2(0., .9), hs), 0.));
  if((m & 2) != 0) r = max(r, step(sdBox(q - vec2(.42, .45), vs), 0.));
  if((m & 4) != 0) r = max(r, step(sdBox(q - vec2(.42, -.45), vs), 0.));
  if((m & 8) != 0) r = max(r, step(sdBox(q - vec2(0., -.9), hs), 0.));
  if((m & 16) != 0) r = max(r, step(sdBox(q - vec2(-.42, -.45), vs), 0.));
  if((m & 32) != 0) r = max(r, step(sdBox(q - vec2(-.42, .45), vs), 0.));
  if((m & 64) != 0) r = max(r, step(sdBox(q, hs), 0.));
  return r;
}
// um número de n algarismos em q (cada algarismo 1 x 2)
float number(vec2 q, float v, int n){
  float r = 0.;
  for(int i=0;i<4;i++){
    if(i >= n) break;
    float dv = floor(mod(v/pow(10., float(n - 1 - i)), 10.));
    vec2 dq = q - vec2(float(i)*1.25, 0.);
    if(abs(dq.x) < .6 && abs(dq.y) < 1.1) r = max(r, seg7(dq, int(dv)));
  }
  return r;
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float asp = R.x/R.y;
  vec3 c = vec3(.035,.035,.04)*(1. + .2*noise(vec2(p.x*3., p.y*700.)));
  vec3 vfd = mix(vec3(.3,1.,.95), nc(.5), .25);
  vec3 amb = vec3(1.,.65,.2);
  // as grelhas das colunas dos lados
  for(int s=0;s<2;s++){
    vec2 gq = p - vec2((s == 0 ? -1. : 1.)*(asp*.5 - .12), 0.);
    if(abs(gq.x) < .1){
      float pump = .5*BASS + .8*kick()*E;
      vec2 hq = gq*(1. - .08*pump*exp(-length(gq)*4.));
      vec2 hf = fract(hq*70.) - .5;
      float hole = smoothstep(.3, .25, length(hf));
      c = mix(vec3(.05), vec3(.0), hole)*(1. + .8*pump*exp(-length(gq)*5.));
      c += nc(.8)*.15*hole*pump*exp(-length(gq)*6.);
    }
  }
  // o vidro do ecrã
  vec2 dq = p - vec2(0., .13);
  float glass = sdBox(dq, vec2(.62, .25));
  if(glass < 0.){
    c = vec3(.008,.014,.016);
    // as barras
    vec2 bq = dq - vec2(.1, -.0);
    float i = floor((bq.x + .45)/.9*24.);
    float fx = fract((bq.x + .45)/.9*24.);
    if(i >= 0. && i < 24. && abs(bq.y) < .2){
      float l = lvl(i, T);
      float pk = l;
      for(int k=1;k<6;k++){ float fk = float(k); pk = max(pk, lvl(i, T - fk*.07) - fk*fk*.006); }
      float sy = (bq.y + .2)/.4*16.;
      float sid = floor(sy), sf = fract(sy);
      float on = step(sid/16., l - .001);
      float peak = step(abs(sid - floor(pk*16.)), .1);
      vec3 col = sid < 10. ? vfd : sid < 13. ? mix(vfd, amb, .6) : amb*vec3(1., .5, .4);
      float shape = step(.12, fx)*step(fx, .88)*step(.18, sf)*step(sf, .82);
      c += col*shape*(.06 + 1.3*max(on, peak));
      c += col*.06*on;
    }
    // números: andamento e tempo
    float bpm = number((dq - vec2(-.565, .12))/vec2(.028, .036), X[6], 3);
    c += amb*bpm*1.2 + amb*.03;
    float tm = number((dq - vec2(-.565, -.04))/vec2(.02, .026), X[7], 2);
    float ts = number((dq - vec2(-.49, -.04))/vec2(.02, .026), X[8], 2);
    c += vfd*(tm + ts);
    c += vfd*step(length(dq - vec2(-.513, -.03)), .003)*step(.5, fract(T));
    c += vfd*step(length(dq - vec2(-.513, -.05)), .003)*step(.5, fract(T));
    // etiquetas pequenas por baixo das barras
    c += vfd*.25*step(abs(dq.y + .225), .004)*step(.6, hash(vec2(floor(dq.x*60.), 2.)))*step(-.37, dq.x);
    c += vec3(.4)*.08*smoothstep(.06, .0, abs(dq.y - dq.x*.25 - .12));
  }
  c = mix(c, vec3(.1), smoothstep(.004, .0, abs(glass))*.6);
  // os botões em fila, com luzes
  for(int b=0;b<7;b++){
    vec2 kq = p - vec2(-.5 + float(b)*.12, -.2);
    float kd = sdBox(kq, vec2(.04, .016));
    c = mix(c, vec3(.1)*(1. + .5*smoothstep(.01, -.01, kq.y)), smoothstep(.002, .0, kd));
    float lit = step(.45, hash(vec2(float(b), floor(BEATN/2.))));
    c += mix(vec3(1.,.15,.05), vfd, step(3., float(b)))*glow(length(kq - vec2(0., .03)), .004)*lit*(.5 + kick());
  }
  // o botão do volume com o anel de luzes
  vec2 vq = p - vec2(.5, -.3);
  float vr = length(vq);
  float vol = clamp(ENER*1.3, 0., 1.);
  c = mix(c, vec3(.13)*(.7 + .5*dot(normalize(vq + 1e-5), vec2(-.6, .8)))*(1. + .2*sin(atan(vq.y, vq.x)*60.)), smoothstep(.09, .088, vr));
  float va = atan(vq.x, -vq.y)/(2.*PI) + .5;
  float dots = smoothstep(.006, .0, abs(vr - .11))*step(.4, fract(va*30.));
  float vin = step(va, .1 + .8*vol)*step(.1, va)*step(va, .9);
  c += mix(vec3(.05), vfd, vin)*dots*1.4;
  c += vfd*.2*exp(-abs(vr - .11)*60.)*vin;
  c += vec3(1.)*.05*DROP;
  c = aces(c*1.3);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`, (x, s) => {
  x[6] = Math.round(s.bpm || 120);
  x[7] = Math.floor(s.time / 60) % 100;
  x[8] = Math.floor(s.time) % 60;
});
