/**
 * Bairro isométrico: um bairro de prédios pequenos visto em isométrica, a
 * deslizar devagar. Os prédios crescem com os graves numa onda que passa
 * pelo bairro em cada compasso, as janelas acendem-se, os carrinhos andam
 * nas ruas. Na queda o bairro salta inteiro e acende-se nas cores da capa.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "bairro",
  name: "Bairro isométrico",
  names: { en: "Isometric block" },
  families: ["electronic"],
  tags: ["cidade", "isométrico", "prédios", "3d", "noite"],
  intensity: 3,
  cost: 2,
  signals: ["energy", "bass", "beat", "bar", "drop", "section", "palette"],
  lyrics: "extrude",
}, CITY + `
float isStreet(vec2 id){ return max(step(mod(id.x, 4.), .5), step(mod(id.y, 5.), .5)); }
float height(vec2 id){
  if(isStreet(id) > .5) return 0.;
  float h = .25 + 1.3*pow(hash(id), 2.);
  float d = length(id - vec2(X[6], X[7]));
  float wave = exp(-abs(d*.35 - fract(BAR)*4.)*2.);
  return h*(1. + .35*BASS*wave + .6*DROP*hash(id + 3.)) + .25*kick()*wave*E;
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  vec3 f = normalize(vec3(-1., -1.05, -1.));
  vec3 r = normalize(cross(f, vec3(0., 1., 0.)));
  vec3 u = cross(r, f);
  float zoom = 7.5 - .4*DROP;
  vec3 center = vec3(X[6], 0., X[7]);
  vec3 ro = center + (r*p.x + u*p.y)*zoom - f*30.;
  vec3 rd = f;
  // começar no plano y = 3 (acima de tudo)
  float t0 = (3.5 - ro.y)/rd.y;
  vec3 pos = ro + rd*t0;
  vec2 cell = floor(pos.xz);
  vec2 stp = sign(rd.xz);
  vec2 tDelta = abs(1./rd.xz);
  vec2 side = (stp*(cell - pos.xz) + stp*.5 + .5)*tDelta;
  vec3 c = vec3(.01,.01,.02);
  float tPrev = 0.;
  bool done = false;
  for(int i=0;i<40;i++){
    float tNext = min(side.x, side.y);
    float h = height(cell);
    float m = .12;
    vec3 bmin = vec3(cell.x + m, 0., cell.y + m), bmax = vec3(cell.x + 1. - m, h, cell.y + 1. - m);
    if(h > 0.){
      vec3 inv = 1./rd;
      vec3 ta = (bmin - pos)*inv, tb = (bmax - pos)*inv;
      vec3 tmn = min(ta, tb), tmx = max(ta, tb);
      float tn = max(max(tmn.x, tmn.y), tmn.z), tf = min(min(tmx.x, tmx.y), tmx.z);
      if(tn < tf && tf > 0.){
        vec3 hp = pos + rd*tn;
        vec3 nrm = tn == tmn.y ? vec3(0., 1., 0.) : tn == tmn.x ? vec3(-stp.x, 0., 0.) : vec3(0., 0., -stp.y);
        float hid = hash(cell);
        vec3 base = mix(vec3(.16,.14,.18), ncv(mix(C1, C2, hid))*.35, .5);
        if(nrm.y > .5){
          // telhado: terraço com caixa de água
          c = base*.9;
          vec2 rq = fract(hp.xz) - .5;
          c *= 1. - .3*smoothstep(.3, .32, max(abs(rq.x), abs(rq.y)));
          c += vec3(1.,.15,.1)*glow(length(rq - .2), .02)*step(.7, hid)*(.4 + kick());
        } else {
          float lightSide = nrm.x != 0. ? .55 : .35;
          c = base*lightSide;
          // janelas na fachada
          vec2 wq = vec2(nrm.x != 0. ? hp.z : hp.x, hp.y)*vec2(5., 6.);
          vec2 wi = floor(wq), wf = fract(wq);
          float win = step(.3, wf.x)*step(wf.x, .7)*step(.3, wf.y)*step(wf.y, .75)*step(hp.y, h - .05)*step(.05, hp.y);
          float lit = step(hash(wi + cell*13. + nrm.xz*7.), .25 + .5*ENER + .3*DROP);
          lit = abs(lit - step(.9, hash(wi + cell + BEATN*.31)));
          vec3 wc = mix(vec3(1.,.75,.4), nc(hash(wi + cell)), clamp(.15 + DROP + .3*step(2.5, SECK), 0., 1.));
          c = mix(c, wc*lit*1.3 + c*.4*(1. - lit), win);
        }
        done = true;
        break;
      }
    }
    {
      // chão no y = 0, dentro desta célula: rua ou passeio
      float tg = -pos.y/rd.y;
      if(tg >= tPrev - 1e-3 && tg <= tNext + 1e-3){
        vec3 gp = pos + rd*tg;
        vec2 gf = fract(gp.xz);
        if(h > 0.){ c = vec3(.05,.05,.06)*(1. - .4*smoothstep(.12, .0, min(min(gf.x, 1. - gf.x), min(gf.y, 1. - gf.y)))); done = true; break; }
        c = vec3(.025,.025,.035);
        // candeeiros nos cruzamentos e carrinhos a andar
        float cross = step(mod(cell.x, 4.), .5)*step(mod(cell.y, 5.), .5);
        c += mix(vec3(1.,.6,.25), nc(.3), DROP)*glow(length(gf - .5), .08)*cross*(.6 + .6*kick());
        float alongX = step(mod(cell.y, 5.), .5)*(1. - cross);
        float alongZ = step(mod(cell.x, 4.), .5)*(1. - cross);
        float carX = fract(gp.x*.25 + T*.3 + hash(vec2(cell.y, 1.)));
        float carZ = fract(gp.z*.2 - T*.25 + hash(vec2(cell.x, 2.)));
        c += vec3(1.,.9,.7)*alongX*smoothstep(.05, .0, abs(gf.y - .35))*smoothstep(.06, .0, abs(carX - .5));
        c += vec3(1.,.1,.05)*alongZ*smoothstep(.05, .0, abs(gf.x - .65))*smoothstep(.06, .0, abs(carZ - .5));
        c += vec3(.25)*smoothstep(.01, .0, abs(gf.y - .5))*alongX*step(.5, fract(gp.x*3.));
        c += vec3(.25)*smoothstep(.01, .0, abs(gf.x - .5))*alongZ*step(.5, fract(gp.z*3.));
        done = true;
        break;
      }
    }
    tPrev = tNext;
    if(side.x < side.y){ side.x += tDelta.x; cell.x += stp.x; } else { side.y += tDelta.y; cell.y += stp.y; }
  }
  if(!done) c = vec3(.02,.02,.03);
  c += nc(.6)*.08*kick()*SEC;
  c *= 1. - .3*length(p);
  c = aces(c*1.4);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`, (x, _s, _dt) => {
  // o centro do bairro desliza na diagonal
  x[6] = x[0] * 0.5;
  x[7] = x[0] * 0.2;
});
