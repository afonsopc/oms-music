/**
 * Fumo e focos: o palco cheio de fumo e seis cabeças móveis na teia,
 * cones de luz a varrer, a capa projectada no chão como um gobo, o
 * vocalista em contraluz. Os ataques disparam o estroboscópio; na queda os
 * focos fecham-se todos no centro e abrem-se para o público.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "focos",
  name: "Fumo e focos",
  names: { en: "Smoke and spotlights" },
  families: ["electronic", "chaos"],
  tags: ["palco", "concerto", "fumo", "luzes", "capa"],
  intensity: 4,
  cost: 2,
  signals: ["energy", "bass", "beat", "bar", "onset", "drop", "section", "cover", "palette"],
  lyrics: "extrude",
}, CITY + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float asp = R.x/R.y;
  vec2 fl = vec2(T*.03, -T*.05);
  vec2 wq = p*2. + vec2(fbm(p*1.5 + fl), fbm(p*1.5 - fl + 3.))*1.2;
  float smoke = fbm(wq + vec2(0., -T*.12));
  smoke = .12 + 1.8*smoke*smoke*smoke;
  smoke *= .7 + .3*smoothstep(-.5, .2, p.y);
  float floorY = -.3;
  vec3 c = vec3(.008,.006,.012) + C1*.015*smoke;
  float calm = step(SECK, .5), peak = step(2.5, SECK);
  vec3 lightFloor = vec3(0.);
  for(int i=0;i<6;i++){
    float fi = float(i);
    vec2 o = vec2((fi - 2.5)/2.5*.42*asp, .46);
    float sweep = sin(BAR*PI*.25*(1. + .3*mod(fi, 2.)) + fi*1.3);
    float a = -PI*.5 + sweep*.55*(1. - .6*calm);
    // na queda: todos ao centro e depois para nós
    float conv = clamp(DROP*1.4, 0., 1.);
    vec2 tgt = vec2(0., floorY);
    float ac = atan(tgt.y - o.y, tgt.x - o.x);
    a = mix(a, ac, conv);
    vec2 dir = vec2(cos(a), sin(a));
    vec2 r = p - o;
    float t = dot(r, dir);
    float d = abs(r.x*dir.y - r.y*dir.x);
    float wid = .03 + t*(.14 + .08*BASS);
    float cone = smoothstep(wid, wid*.3, d)*step(0., t);
    float hitT = (floorY - o.y)/dir.y;
    cone *= step(t, hitT + .02);
    vec3 col = mix(vec3(1.,.9,.75), nc(fi/6. + floor(BAR/8.)*.3), clamp(.3 + .7*SEC, 0., 1.));
    float onb = mix(1., step(.5, fract((fi + BEATN)*.5)), peak*(1. - conv));
    float I = cone*exp(-t*.9)*(.35 + .5*kick() + .5*E)*onb;
    c += col*I*smoke*1.1;
    c += col*glow(length(r), .018)*(1. + kick())*onb;
    // a poça no chão (y achatado)
    vec2 hp = o + dir*hitT;
    vec2 fq = (p - hp)*vec2(1., 3.2);
    float pr = wid*(hitT/max(t,.001))*0. + (.03 + hitT*(.14 + .08*BASS));
    float pool = smoothstep(pr, pr*.6, length(fq))*step(p.y, floorY + .06);
    // gobo: a capa projectada nos focos do meio
    vec3 g = (i == 2 || i == 3) ? cov(fq/(pr*2.) + .5)*1.4 : vec3(1.);
    lightFloor += col*g*pool*onb*(.5 + .6*kick());
  }
  // o chão do palco
  if(p.y < floorY){
    vec3 st = vec3(.015,.013,.018)*(1. + .4*noise(vec2(p.x*40., p.y*200.)));
    c = st + lightFloor*.9 + c*.25;
  }
  // a teia em cima
  c = mix(c, vec3(.03), smoothstep(.006, .0, abs(p.y - .47) - .008));
  c = mix(c, vec3(.03), smoothstep(.003, .0, abs(fract(p.x*12.) - .5) - .45)*step(abs(p.y - .47), .01));
  // o vocalista e o microfone
  vec2 q = (p - vec2(0., floorY))/1.5;
  float body = sdSeg(q, vec2(0., .0), vec2(0., .2)) - .035 + .01*q.y*10.*0.;
  float head = length(q - vec2(0., .27)) - .032;
  float legs = min(sdSeg(q, vec2(.0, .02), vec2(.035, -.01)), sdSeg(q, vec2(0., .02), vec2(-.035, -.01))) - .014;
  float stand = min(sdSeg(q, vec2(.08, 0.), vec2(.06, .24)), sdSeg(q, vec2(.06, .24), vec2(.02, .26))) - .004;
  float arm = sdSeg(q, vec2(0., .18), mix(vec2(.03, .26), vec2(.1, .42), clamp(DROP*1.5 + peak*.3*kick(), 0., 1.))) - .012;
  float sil = min(min(min(body, head), legs), min(stand, arm));
  c *= mix(.03, 1., smoothstep(0., .004, sil));
  c += nc(.5)*smoothstep(.006, .0, abs(sil + .002))*(.25 + .5*kick())*step(-.3, -abs(p.x));
  // estroboscópio nos ataques, só a sério nas secções fortes
  c += vec3(1.)*.35*step(.6, ON)*peak;
  c = aces(c*1.3);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
