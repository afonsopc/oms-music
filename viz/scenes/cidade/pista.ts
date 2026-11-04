/**
 * Pista de dança: um chão de ladrilhos de luz a perder de vista, cada
 * secção com o seu desenho (xadrez, anéis, varrimento, equalizador,
 * aleatório), uma bola de espelhos a espalhar pontos de luz, e gente a
 * saltar em contraluz. Na queda o chão rebenta numa onda.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "pista",
  name: "Pista de dança",
  names: { en: "Dance floor" },
  families: ["electronic"],
  tags: ["discoteca", "clube", "dança", "luzes", "anos-70"],
  intensity: 4,
  cost: 1,
  signals: ["energy", "bass", "lowmid", "mid", "high", "beat", "bar", "drop", "section", "palette"],
  lyrics: "neon",
}, CITY + `
float pattern(vec2 id, float mode){
  float bt = BEATN;
  if(mode < .5) return step(.5, mod(id.x + id.y + bt, 2.));
  if(mode < 1.5){ float d = length(id - vec2(0., 6.)); return smoothstep(1.2, 0., abs(fract(d*.12 - BPH*.5 - bt*.25) - .5)*8.); }
  if(mode < 2.5){ return smoothstep(1.5, 0., abs(mod(id.x - id.y*.5 - bt*2., 12.) - 6.)); }
  if(mode < 3.5){ float b = abs(id.x) < 2. ? B : abs(id.x) < 4. ? LM : abs(id.x) < 6. ? M : H; return step(id.y, 2. + b*12.); }
  return step(.72, hash(id + bt*.17));
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float hz = .12;
  vec3 c = vec3(.01,.006,.018);
  float mode = mod(floor(BAR/4.) + SECK*2., 5.);
  // a parede do fundo com luz que vem do chão
  c += nc(.6)*.05*exp(-(p.y - hz)*5.)*(1. + kick());
  // a bola de espelhos
  vec2 bp = p - vec2(0., .36);
  float br = .075;
  float bl = length(bp);
  if(bl < br){
    vec3 n = vec3(bp/br, sqrt(max(0., 1. - dot(bp,bp)/(br*br))));
    float lon = atan(n.x, n.z) + T*.8, lat = asin(n.y);
    vec2 fid = floor(vec2(lon*7., lat*7.));
    float tw = hash(fid + floor(T*6.));
    c = vec3(.15,.15,.18)*n.z + vec3(1.)*step(.93 - .05*kick(), tw) + nc(hash(fid))*.15;
  }
  c += vec3(.9)*.04*glow(bl, .2);
  // os raios da bola
  float ra = atan(bp.y, bp.x);
  float rays = pow(max(0., sin(ra*9. + T*1.3)), 40.)*smoothstep(.5, .0, bl)*step(br, bl);
  c += nc(.3)*rays*.3*(.4 + E);
  // o chão
  if(p.y < hz){
    float z = .7/(hz - p.y);
    vec2 wq = vec2(p.x*z, z + TRAVEL*.0);
    vec2 g = wq/.7;
    vec2 id = floor(g), f = fract(g) - .5;
    float lit = pattern(id, mode);
    lit = max(lit, DROP*smoothstep(1., 0., abs(z - 1. - (1. - DROP)*14.)));
    vec3 tc = nc(hash(id)*.3 + id.y*.05 + floor(BAR/8.)*.2);
    float bevel = smoothstep(.5, .4, max(abs(f.x), abs(f.y)));
    float core = smoothstep(.5, .1, max(abs(f.x), abs(f.y)));
    vec3 floorc = vec3(.02,.02,.03)*bevel;
    floorc += tc*lit*(core*.9 + .3)*bevel*(.55 + .6*kick() + .4*E);
    // os pontos da bola de espelhos no chão
    vec2 sq = rot(T*.35)*(wq - vec2(0., 6.))*1.4;
    vec2 si = floor(sq), sf = fract(sq) - .5;
    floorc += vec3(1.)*glow(length(sf), .05)*step(.7, hash(si))*.8;
    float fog = exp(-z*.06);
    c = mix(c + nc(.6)*.03, floorc, fog);
  }
  // gente a dançar em contraluz
  for(int i=0;i<7;i++){
    float fi = float(i);
    float x = (fi - 3.)*.24 + .03*sin(T*.7 + fi);
    float sc = .9 + .3*hash(vec2(fi, 2.));
    float jump = .03*kick()*step(.4, hash(vec2(fi, BEATN))) + .02*DROP;
    vec2 q = (p - vec2(x, -.32 + jump))/sc;
    float body = sdSeg(q, vec2(0., 0.), vec2(0., .14)) - .03;
    float head = length(q - vec2(0., .2)) - .03;
    float up = step(.5, hash(vec2(fi, floor(BEATN/2.)))) + DROP;
    vec2 hand = mix(vec2(.09, .04), vec2(.07, .3), clamp(up, 0., 1.));
    float arms = min(sdSeg(q, vec2(0., .12), hand*vec2(1., 1.)), sdSeg(q, vec2(0., .12), hand*vec2(-1., 1.) + vec2(0., -.1*(1. - up)))) - .012;
    float legs = min(sdSeg(q, vec2(0., 0.), vec2(.05, -.18)), sdSeg(q, vec2(0., 0.), vec2(-.05, -.18))) - .015;
    float d = min(min(body, head), min(arms, legs));
    c *= smoothstep(0., .004, d);
  }
  c += vec3(1.)*.12*ON*step(2.5, SECK);
  c = aces(c*1.3);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
