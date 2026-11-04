/**
 * Chuva de néon: uma rua molhada à noite. Letreiros de néon (anéis, setas,
 * colunas, uma caixa de luz com a capa) zumbem e falham, o asfalto reflecte
 * tudo a tremer, a chuva cai iluminada por eles e cada batida abre um
 * círculo nas poças. Na queda acendem-se todos de uma vez.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "chuva-neon",
  name: "Chuva de néon",
  names: { en: "Neon rain" },
  families: ["electronic"],
  tags: ["néon", "chuva", "cidade", "noite", "reflexo", "capa"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "high", "beat", "onset", "drop", "cover", "palette"],
  lyrics: "neon",
}, CITY + `
float buzz(float i){
  float on = step(.12 - .1*DROP, hash(vec2(i, floor(T*14.))));
  on *= 1. - step(.75, ON*hash(vec2(i, floor(T*30.))));
  return mix(.25, 1., on);
}
vec3 tube(float d, float b, vec3 col){
  return col*(glow(d, .0035 + b)*.9 + glow(d, .03 + b*3.)*.35) + vec3(1.)*glow(d, .0012 + b*.5)*.5;
}
// os letreiros, com "b" de desfoque para o reflexo
vec3 signs(vec2 q, float b){
  vec3 c = vec3(0.);
  float k = 1. + .7*kick() + 1.2*DROP;
  // anel grande
  c += tube(abs(length(q - vec2(-.55,.28)) - .13), b, nc(.0))*buzz(1.)*k;
  c += tube(abs(length(q - vec2(-.55,.28)) - .085), b, nc(.15))*buzz(2.)*k*.7;
  // coluna de blocos (letreiro vertical)
  vec2 cq = q - vec2(.62,.25);
  float col = 1e3;
  for(int i=0;i<5;i++){ float y = .2 - float(i)*.1; col = min(col, abs(sdBox(cq - vec2(0.,y), vec2(.035,.03)))); }
  c += tube(col, b, nc(.4))*buzz(3.)*k;
  // seta a piscar em sequência
  vec2 aq = q - vec2(.05,.42);
  for(int i=0;i<3;i++){
    vec2 r = aq - vec2(float(i)*.07 - .07, 0.);
    float ch = abs(abs(r.y)*1. - r.x*.0 + r.x) ;
    float d = abs(sdSeg(r, vec2(-.02,.035), vec2(.02,0.)));
    d = min(d, sdSeg(r, vec2(-.02,-.035), vec2(.02,0.)));
    float seq = step(.5, fract(BPH*.5 + BEATN*.25 - float(i)*.33));
    c += tube(d, b, nc(.7))*mix(.15, 1., max(seq, DROP))*k;
  }
  // risca comprida por cima da porta
  c += tube(sdSeg(q, vec2(-.25,.1), vec2(.32,.1)), b, nc(.85))*buzz(5.)*k*.8;
  // caixa de luz com a capa
  vec2 bq = q - vec2(.22,.27);
  float bd = sdBox(bq, vec2(.1,.1));
  if(bd < 0.) c += cov(bq/.2 + .5)*(.9 + .4*kick())*mix(1., .35, step(.001, b));
  c += tube(abs(bd), b, nc(.3))*.6*buzz(6.);
  return c;
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float hz = -.12;
  vec3 c = vec3(0.);
  if(p.y > hz){
    // a parede dos prédios: tijolo escuro
    vec2 bp = p*vec2(30.,60.); bp.x += step(1., mod(floor(bp.y),2.))*.5;
    float brick = smoothstep(.04,.1, min(fract(bp.x), fract(bp.y)));
    c = vec3(.018,.014,.02)*(.6 + .4*brick)*(1. + .5*noise(p*8.));
    // porta e montra
    float door = sdBox(p - vec2(.02,-.0), vec2(.2,.1));
    if(door < 0.) c = mix(vec3(.01,.01,.02), nc(.6)*.12, smoothstep(-.1,.1,p.y))*(1. + .3*sin(p.x*80.));
    c += signs(p, 0.);
    c += nc(.5)*.03*E;
  } else {
    // o asfalto: reflexo tremido e desfocado, mais escuro
    float depth = (hz - p.y);
    float z = .08/max(depth, .002);
    vec2 g = vec2(p.x*z, z);
    float rip = 0.;
    // um círculo por batida, em sítios diferentes
    for(int i=0;i<4;i++){
      float bn = BEATN - float(i);
      vec2 cc = vec2((hash(vec2(bn,1.)) - .5)*2.4*z/z, .25 + 1.4*hash(vec2(bn,2.)));
      vec2 gp = vec2(p.x*z*.5, z*.25);
      float age = float(i) + BPH;
      float r = age*.18;
      float d = length((gp - vec2(cc.x*.5, cc.y*.25))*vec2(1.,1.));
      rip += sin((d - r)*90.)*exp(-abs(d - r)*40.)*exp(-age*.9);
    }
    vec2 w = vec2(fbm(g*vec2(3.,1.) + vec2(0., T*.4)) - .5, 0.)*.03;
    w.x += rip*.006;
    vec2 rq = vec2(p.x, 2.*hz - p.y) + w;
    float blur = .004 + depth*.05;
    c = signs(rq, blur)*.55*(.7 + .3*fbm(g*6.));
    c += vec3(.01,.01,.015);
    c *= .6 + .4*smoothstep(.0,.25,depth);
    // a linha da beira do passeio
    c += vec3(.25)*glow(p.y - hz, .0015)*.4;
  }
  // a chuva, iluminada pelos néons
  vec3 lightCol = (nc(.0) + nc(.4) + nc(.7))*.33;
  for(int i=0;i<3;i++){
    float fi = float(i);
    vec2 rp = (p + vec2(p.y*.12, 0.))*vec2(70. + fi*40., 2. + fi);
    rp.y += T*(5. + fi*2.)*(1. + .3*E) + hash(vec2(floor(rp.x), fi))*10.;
    float id = floor(rp.x);
    float s = smoothstep(.1, 0., abs(fract(rp.x) - .5))*smoothstep(.85, 1., fract(rp.y))*step(.45, hash(vec2(id, fi + 4.)));
    c += lightCol*s*(.35 + .15*fi)*(.7 + H + .5*kick());
  }
  c += nc(.2)*.15*DROP;
  c = aces(c*1.15);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
