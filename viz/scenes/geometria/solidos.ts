/**
 * Sólidos de vidro: um sólido platónico de cristal (cubo, octaedro,
 * dodecaedro, icosaedro) a rodar à frente da capa. A luz refracta-se lá
 * dentro e separa-se em cores; em cada secção o sólido funde-se no
 * seguinte, a batida faz-lhe um pulso e a queda dá-lhe arco-íris a sério.
 */
import { HEAD, geoScene } from "./_lib";

export default geoScene({
  id: "solidos",
  name: "Sólidos de vidro",
  names: { en: "Glass solids", lv: "Stikla daudzskaldņi" },
  families: ["calm", "electronic"],
  tags: ["3d", "vidro", "prisma", "platónico", "capa"],
  intensity: 2,
  cost: 2,
  signals: ["energy", "bass", "high", "beat", "drop", "section", "cover", "palette"],
  lyrics: "ink",
}, HEAD + `
#define PHI 1.618034
float gdf(vec3 p, float kind){
  p = abs(p);
  if(kind < .5) return max(p.x, max(p.y, p.z));
  if(kind < 1.5) return dot(p, vec3(.57735));
  if(kind < 2.5){
    vec3 n1 = normalize(vec3(0., 1., PHI)), n2 = normalize(vec3(1., PHI, 0.)), n3 = normalize(vec3(PHI, 0., 1.));
    return max(max(dot(p, n1), dot(p, n2)), dot(p, n3));
  }
  vec3 n1 = normalize(vec3(0., 1./PHI, PHI)), n2 = normalize(vec3(1./PHI, PHI, 0.)), n3 = normalize(vec3(PHI, 0., 1./PHI));
  return max(max(max(dot(p, n1), dot(p, n2)), dot(p, n3)), dot(p, vec3(.57735)));
}
float KA, KB, MORPH, SIZE;
mat3 RM;
float map(vec3 p){
  p = RM*p;
  float a = gdf(p, KA), b = gdf(p, KB);
  return (mix(a, b, MORPH) - SIZE)*.9;
}
vec3 env(vec3 d){
  vec3 c = mix(C1*.05, C1*.25, smoothstep(-.6, .8, d.y));
  // a capa num painel atrás
  if(d.z < -.2){
    vec2 cu = d.xy/(-d.z)*.55 + .5;
    if(cu.x > 0. && cu.x < 1. && cu.y > 0. && cu.y < 1.) c += texture(COVER, vec2(cu.x, 1. - cu.y)).rgb*.75;
  }
  // duas luzes de estúdio e um anel que pulsa
  c += vec3(1.)*smoothstep(.96, .995, dot(d, normalize(vec3(-.6, .7, .3))))*2.;
  c += vivid(C3)*smoothstep(.93, .99, dot(d, normalize(vec3(.8, .2, .4))))*1.6;
  float ring = smoothstep(.06, 0., abs(d.y - .1 + .05*sin(atan(d.x, d.z)*3.)));
  c += vivid(C2)*ring*(.4 + 1.5*BEAT + DROP);
  return c;
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float k = mod(SIDX + floor(SEED*4.), 4.);
  // a fusão: começa na mudança de secção (SHIFT 1 -> 0), o sólido anterior desfaz-se no novo
  KB = k; KA = mod(k + 3., 4.); MORPH = 1. - SHIFT;
  SIZE = .78 + .08*KICK + .05*B;
  float a = TF*.22, b = TF*.15 + .4;
  RM = mat3(cos(a),0.,sin(a), 0.,1.,0., -sin(a),0.,cos(a)) * mat3(1.,0.,0., 0.,cos(b),-sin(b), 0.,sin(b),cos(b));
  vec3 ro = vec3(0., 0., 3.6), rd = normalize(vec3(p, -1.5));
  vec3 col = env(rd);
  float tt = 1.8, d = 1.;
  for(int i=0;i<48;i++){
    d = map(ro + rd*tt);
    if(d < .001 || tt > 5.5) break;
    tt += d;
  }
  if(d < .01){
    vec3 pos = ro + rd*tt;
    vec2 e = vec2(.0015, 0.);
    vec3 n = normalize(vec3(map(pos+e.xyy)-map(pos-e.xyy), map(pos+e.yxy)-map(pos-e.yxy), map(pos+e.yyx)-map(pos-e.yyx)));
    float fres = .04 + .96*pow(1. - max(dot(n, -rd), 0.), 5.);
    vec3 refl = env(reflect(rd, n));
    // atravessar o vidro: refractar, marchar por dentro até à saída
    vec3 ri = refract(rd, n, 1./1.5);
    float ti = .02;
    vec3 pi = pos;
    float steps = Q > 1.5 ? 24. : 14.;
    for(int i=0;i<24;i++){
      if(float(i) >= steps) break;
      float di = -map(pos + ri*ti);
      if(di < .001) break;
      ti += max(di, .01);
    }
    pi = pos + ri*ti;
    vec3 n2 = -normalize(vec3(map(pi+e.xyy)-map(pi-e.xyy), map(pi+e.yxy)-map(pi-e.yxy), map(pi+e.yyx)-map(pi-e.yyx)));
    float disp = .02 + .05*H + .12*DROP + .03*PK;
    vec3 tr;
    vec3 oR = refract(ri, n2, 1.5 - disp), oG = refract(ri, n2, 1.5), oB = refract(ri, n2, 1.5 + disp);
    if(dot(oG, oG) < .5) oG = reflect(ri, n2);
    if(dot(oR, oR) < .5) oR = oG;
    if(dot(oB, oB) < .5) oB = oG;
    tr = vec3(env(oR).r, env(oG).g, env(oB).b);
    tr *= mix(vec3(1.), vivid(C2), .25) * exp(-ti*.25);
    col = mix(tr, refl, fres);
    // arestas a brilhar (onde a normal muda depressa)
    float edge = smoothstep(.15, .5, length(fwidth(n)));
    col += vivid(C3)*edge*(.3 + .8*KICK);
  }
  col *= .85 + .3*E;
  col *= 1. - .3*dot(p,p) - .2*LY*smoothstep(.45,0.,abs(p.y+.05));
  o = vec4(post(aces(col*1.15), gl_FragCoord.xy), 1.);
}`);
