/**
 * Auto-estrada nocturna: fotografia de longa exposição a correr. Rastos
 * brancos de quem vem e vermelhos de quem vai, candeeiros a passar, o
 * asfalto molhado a reflectir tudo, e um pórtico de sinalização com a capa.
 * Os graves dão a velocidade; a queda abre a lente e pinta os rastos.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "autoestrada",
  name: "Auto-estrada nocturna",
  names: { en: "Night motorway" },
  families: ["electronic"],
  tags: ["cidade", "noite", "estrada", "velocidade", "capa"],
  intensity: 3,
  cost: 1,
  signals: ["energy", "bass", "beat", "drop", "section", "cover", "palette"],
  lyrics: "neon",
}, CITY + `
const float CAM = 1.25;
// um rasto de luzes a uma altura e a um lado: no ecrã é uma recta que sai do ponto de fuga
vec3 trail(vec2 p, vec2 v, float s0, float dens, vec3 col, float blur){
  float dv = dot(p, v); if(dv <= 1e-4) return vec3(0.);
  float vl = length(v), z = vl*vl/dv;
  if(z < .8) return vec3(0.);
  float d = abs(p.x*v.y - p.y*v.x)/vl;
  float w = .045/z + .0009 + blur;
  float s = z*.045 + s0, id = floor(s), f = fract(s);
  float on = step(hash1(id + s0*0.01 + v.x*7.), dens) * smoothstep(0.,.06,f) * smoothstep(1.,.55,f);
  return col * on * (glow(d, w) + .06*glow(d, w*5.)) * exp(-z*.02);
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  p += vec2(sin(T*.31)*.01, -.09 + .004*kick()*BASS);
  p *= 1. - .12*DROP - .04*kick()*B;
  float run = TRAVEL*18.;
  vec3 tail = mix(vec3(1.,.08,.04), nc(.05), .35 + .65*DROP);
  vec3 head = mix(vec3(1.,.92,.75), nc(.55), .2 + .6*DROP);
  vec3 sodium = mix(vec3(1.,.55,.18), nc(.8), .3);
  vec3 c = vec3(0.);
  // céu: a cidade a acender o horizonte
  if(p.y > 0.){
    c = mix(mix(vec3(.08,.05,.12), C1*.35, .5), vec3(.0,.0,.02), smoothstep(0.,.45,p.y));
    float bx = floor(p.x*28.), hb = .015 + .07*hash(vec2(bx,1.))*hash(vec2(bx,2.)) + .05*step(.92,hash(vec2(bx,3.)));
    if(p.y < hb){
      c = vec3(.012,.01,.02);
      vec2 wg = floor(p*vec2(170.,260.));
      c += step(.84 - .1*ENER, hash(wg)) * mix(vec3(1.,.7,.4), nc(hash(wg+.5)), .4) * .35;
      c += vec3(1.,.1,.1)*glow(length(p - vec2((bx+.5)/28., hb+.004)), .0015)*step(.9,hash(vec2(bx,3.)))*(.4+.6*kick());
    }
    float st = step(.997, hash(floor(p*vec2(300.,300.))))*smoothstep(.1,.4,p.y);
    c += st*.5;
  } else {
    // asfalto molhado com as riscas
    float z = CAM/max(-p.y, 1e-3), xw = p.x*z;
    vec3 asph = vec3(.018,.02,.028)*(1. + .6*fbm(vec2(xw*2., z*.6)));
    float fw = fwidth(xw)*1.2 + .02;
    float dash = step(.45, fract((z + run)/7.));
    float lane = 0.;
    lane += smoothstep(fw+.06, .06, abs(xw - 2.3))*dash;
    lane += smoothstep(fw+.06, .06, abs(xw + 2.9))*dash;
    lane += smoothstep(fw+.05, .05, abs(xw + .2));
    lane += smoothstep(fw+.05, .05, abs(xw - .05));
    lane += smoothstep(fw+.08, .08, abs(xw - 4.9)) + smoothstep(fw+.08, .08, abs(xw + 5.6));
    c = asph + lane*vec3(.32,.28,.2)*exp(-z*.05)*smoothstep(.0,.03,-p.y+.0)*(.5+.5*smoothstep(1.5,6.,z));
    // poças de luz dos candeeiros
    float lz = fract((z + run*.5)/26.);
    c += sodium*.2*exp(-abs(lz-.5)*7.)*(exp(-abs(abs(xw+.35)-6.)*.6))*exp(-z*.03)*(.6 + .8*kick());
  }
  // rastos: os nossos (vermelhos, a afastar-se devagar) e os de quem vem (brancos, depressa)
  float far = run*.045;
  for(int i=0;i<2;i++){
    float x0 = i==0 ? 1.1 : 3.6;
    float s0 = -far*.25 + T*.2*float(i+1);
    for(int k=0;k<2;k++){
      float xs = x0 + (k==0 ? -.38 : .38);
      c += trail(p, vec2(xs, .55-CAM), s0, .78, tail, 0.) * (1.3 + .7*BEAT);
      c += trail(p, vec2(xs, -.55-CAM), s0, .78, tail, .004) * .28;
    }
  }
  for(int i=0;i<2;i++){
    float x0 = i==0 ? -1.6 : -4.2;
    float s0 = far*1.6 + float(i)*3.7;
    for(int k=0;k<2;k++){
      float xs = x0 + (k==0 ? -.4 : .4);
      c += trail(p, vec2(xs, .62-CAM), s0, .6 + .3*E, head, 0.) * 1.2;
      c += trail(p, vec2(xs, -.62-CAM), s0, .6 + .3*E, head, .005) * .25;
    }
  }
  // candeeiros dos dois lados
  for(int k=0;k<2;k++){
    float side = k==0 ? -6.2 : 6.2;
    vec2 v = vec2(side, 7.2-CAM);
    float ph = run*.5;
    float dv = dot(p, v); 
    if(dv > 0.){
      float z = dot(v,v)/dv;
      float zn = (floor((z + ph)/26.) + .5)*26. - ph;
      if(zn > 1.){
        vec2 sp = v/zn;
        float r = length(p - sp);
        c += sodium*(glow(r, .35/zn + .002)*1.6 + glow(r, 1.2/zn)*.12)*(.7 + .9*kick())*exp(-zn*.012);
      }
    }
  }
  // o pórtico com a capa, de 90 em 90 m
  float zg = 90. - mod(run, 90.) + 3.;
  vec2 wp = vec2(p.x*zg, CAM + p.y*zg);
  vec2 bc = vec2(2.3, 5.2), bs = vec2(1.7, 1.7);
  float bd = sdBox(wp - bc, bs);
  float beam = sdBox(wp - vec2(0.,7.), vec2(7.5,.14));
  float leg = min(sdBox(wp - vec2(-6.8,3.5), vec2(.12,3.5)), sdBox(wp - vec2(6.8,3.5), vec2(.12,3.5)));
  float fade = smoothstep(93., 60., zg);
  float edge = fwidth(wp.x)*1.5;
  if(min(beam, leg) < 0.) c = mix(c, vec3(.02,.02,.03), fade);
  if(bd < 0.){
    vec2 q = (wp - bc)/(2.*bs) + .5;
    vec3 art = cov(q) * (1.1 + .5*kick());
    c = mix(c, art, fade*smoothstep(0., edge, -bd));
  }
  c += nc(.3)*glow(max(bd,0.), .02*zg/10.)*.5*fade*(.5 + kick());
  c += vec3(1.)*.25*DROP*exp(-length(p)*3.);
  c = aces(c*1.1);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
