/**
 * Tochas da claque: a bancada à noite, tochas vermelhas acesas no meio da
 * multidão, o fumo a subir e a encher o céu, uma faixa enorme a ondular à
 * frente nas cores da capa. A bancada salta na batida; na subida acendem-se
 * mais tochas e na queda o estádio inteiro arde, com o fumo nas cores da capa.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "tochas",
  name: "Tochas da claque",
  names: { en: "Ultras flares" },
  families: ["chaos"],
  tags: ["estádio", "claque", "fumo", "fogo", "multidão"],
  intensity: 5,
  cost: 2,
  signals: ["energy", "bass", "beat", "drop", "section", "palette"],
  lyrics: "glitch",
}, CITY + `
vec2 flarePos(float i){
  return vec2((hash(vec2(i, 1.)) - .5)*1.7, -.36 + .36*hash(vec2(i, 2.)));
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float k = kick();
  float count = 3. + 6.*SEC + 5.*step(1.5, SECK)*step(SECK, 2.5)*clamp(SECAGE/7., 0., 1.) + 6.*DROP;
  vec3 red = vec3(1., .18, .08);
  vec3 smokeCol = mix(vec3(.6,.25,.2), nc(.0), clamp(.25 + DROP + step(2.5, SECK)*.5, 0., 1.));
  // a luz das tochas neste píxel
  vec3 light = vec3(0.);
  float smokeCols = 0.;
  for(int j=0;j<14;j++){
    float fj = float(j);
    if(fj >= count) break;
    vec2 fp = flarePos(fj) + vec2(0., .01*k);
    float fl = .75 + .25*noise(vec2(T*14., fj*3.));
    vec3 fc = mix(red, nc(fj*.17), step(10., fj)*.8);
    vec2 d = p - fp;
    light += fc*fl*.012/(dot(d, d) + .002);
    // a coluna de fumo de cada tocha, a inclinar com o vento
    float hgt = p.y - fp.y;
    if(hgt > 0.){
      float wx = d.x - hgt*(.25 + .1*sin(T*.2 + fj));
      smokeCols += exp(-wx*wx/(.002 + hgt*hgt*.15))*smoothstep(.0, .05, hgt);
    }
  }
  // o fumo: colunas + o tecto de fumo que se vai juntando
  vec2 sq = p*vec2(2.2, 1.6) + vec2(T*.03, -T*.18);
  float n = fbm(sq + vec2(fbm(sq*1.3 + T*.05), 0.)*1.4);
  float sky = smoothstep(-.1, .45, p.y)*(.35 + .55*SEC + .4*DROP);
  float dens = clamp((smokeCols*2.2 + sky*1.3)*(.15 + 1.9*n*n), 0., 1.6);
  vec3 c = vec3(.006,.005,.01) + C1*.03;
  // os holofotes do estádio, lá no alto, a atravessar o fumo
  c += vec3(.9,.95,1.)*.3*glow(length(p - vec2(-.75, .45)), .012) + vec3(.9,.95,1.)*.3*glow(length(p - vec2(.75, .45)), .012);
  vec3 lit = smokeCol*(.03 + light*.4) + nc(.6)*.04*(1. + 2.*k*SEC);
  c = mix(c, lit, clamp(dens*.85, 0., 1.));
  // a bancada: filas de cabeças, a saltar
  if(p.y < .02){
    float row = floor((p.y + .5)/.055);
    float sc = 20. + row*1.6;
    float jump = .012*k*step(.5, mod(row + floor(BEATN/2.), 2.))*(.4 + E) + .02*DROP*k;
    float x = p.x*sc + row*.37;
    float cx = floor(x), fx = fract(x) - .5;
    vec2 hq = vec2(fx/sc, p.y - (-.5 + (row + .55)*.055 + jump + .006*hash(vec2(cx, row))));
    float head = length(hq) - .45/sc;
    float shoulder = hq.y + .012 - .0;
    float arms = step(.82 - .3*SEC - .4*DROP, hash(vec2(cx, row + floor(BEATN/4.)*7.)));
    float arm = sdSeg(hq, vec2(.004, .0), vec2(.01*sin(cx), .045 + .01*k)) - .003;
    float sil = min(min(head, shoulder), mix(1., arm, arms));
    float near = 1. - row/10.;
    vec3 crowd = vec3(.004) + light*light*.02*(.5 + .5*near);
    crowd *= .3 + .7*smoothstep(-.01, .012, hq.y);
    c = mix(c, crowd, smoothstep(.002, .0, sil));
  }
  // o fogo das tochas por cima de tudo
  for(int j=0;j<14;j++){
    float fj = float(j);
    if(fj >= count) break;
    vec2 fp = flarePos(fj) + vec2(0., .01*k);
    vec2 d = p - fp - vec2(0., .012);
    float fl = .7 + .3*noise(vec2(T*20., fj));
    vec3 fc = mix(red, nc(fj*.17), step(10., fj)*.8);
    c += (vec3(1.,.9,.8)*glow(length(d*vec2(1., .6)), .004)*1.5 + fc*glow(length(d), .03)*.6)*fl;
    // faúlhas a subir
    vec2 sp = (d - vec2(0., T*.0))*vec2(60., 20.);
    sp.y -= T*6. + fj*3.;
    vec2 si = floor(sp), sf = fract(sp) - .5;
    c += vec3(1.,.6,.2)*step(.93, hash(si + fj))*glow(length(sf), .08)*exp(-length(d)*12.)*step(0., d.y);
  }
  // a faixa à frente
  float wave = .02*sin(p.x*7. - T*2.5) + .01*sin(p.x*13. + T*3.);
  float ban = -.36 + wave;
  if(p.y < ban){
    float stripe = floor((p.x + T*.0)*4. + 10.);
    vec3 bc = nc(mod(stripe, 3.)*.33);
    float shade = .55 + .45*cos(p.x*7. - T*2.5);
    c = bc*(.12 + .2*shade)*(1. + light*.04) + light*.02;
  }
  c += vec3(1.,.4,.3)*.15*DROP*k;
  c = aces(c*1.1);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
