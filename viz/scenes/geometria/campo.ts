/**
 * Campo vectorial: o desenho do próprio campo, como limalha à volta de
 * ímanes. Quatro vórtices (um por faixa) e uma fonte que bate com o bombo;
 * as linhas de fluxo correm e brilham, a cor diz a direcção. Na queda o
 * campo inverte-se e explode para fora.
 */
import { HEAD, geoScene } from "./_lib";

export default geoScene({
  id: "campo",
  name: "Campo vectorial",
  names: { en: "Vector field", lv: "Vektoru lauks" },
  families: ["calm", "electronic"],
  tags: ["fluxo", "física", "linhas", "hipnótico"],
  intensity: 2,
  cost: 2,
  signals: ["energy", "bass", "lowmid", "mid", "high", "beat", "drop", "section", "palette"],
  lyrics: "ink",
}, HEAD + `
vec2 V[4]; float W[4];
vec2 field(vec2 p){
  vec2 v = vec2(0.);
  for(int i=0;i<4;i++){
    vec2 d = p - V[i];
    float r2 = dot(d,d) + .02;
    v += W[i]*vec2(-d.y, d.x)/r2;
  }
  // a fonte central: respira com os graves, explode na queda
  float src = .15*KICK + 1.2*DROP - .05;
  v += src*p/(dot(p,p) + .05);
  v += .25*vec2(sin(p.y*3. + TF*.3), cos(p.x*2.7 - TF*.25));
  return v;
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float t = TF*.15;
  for(int i=0;i<4;i++){
    float fi = float(i);
    V[i] = vec2(.55*sin(t*(.7+.13*fi) + fi*1.7 + SEED*6.), .32*cos(t*(.5+.11*fi) + fi*2.3));
  }
  float flip = mod(SG, 2.) < 1. ? 1. : -1.;
  W[0] = (.12 + .35*B)*flip; W[1] = -(.1 + .3*LM)*flip; W[2] = (.1 + .3*M); W[3] = -(.08 + .3*H);
  // convolução ao longo da linha de fluxo: segue o campo para os dois lados e soma ruído
  float steps = Q > 1.5 ? 14. : 9.;
  float h = 1.6/R.y*(Q > 1.5 ? 1. : 1.5);
  float acc = 0., wsum = 0.;
  vec2 a = p, b = p;
  float ph = TF*1.2;
  for(int i=0;i<14;i++){
    if(float(i) >= steps) break;
    vec2 va = field(a), vb = field(b);
    a += normalize(va + 1e-5)*h*3.;
    b -= normalize(vb + 1e-5)*h*3.;
    float w = 1. - float(i)/steps;
    // ruído fino a deslizar ao longo da linha: os traços parecem correr
    acc += w*(hash(floor(a*R.y*.5)) + hash(floor(b*R.y*.5)));
    wsum += 2.*w;
  }
  float lic = acc/wsum;
  vec2 v = field(p);
  float speed = length(v);
  float ang = atan(v.y, v.x);
  // riscas a correr no sentido do campo (a fase avança com o tempo)
  float run = .5 + .5*sin(ang*2. + length(p)*9. - ph*3.);
  vec3 tint = pal(ang/TAU + TF*.02);
  float lines = pow(smoothstep(.3, .75, lic), 2.)*1.6;
  vec3 col = vivid(tint)*lines*(.25 + .6*smoothstep(0., 3., speed)) * (.6 + .5*run);
  col += tint*.06;
  // os vórtices brilham
  for(int i=0;i<4;i++){ float d = length(p - V[i]); col += vivid(pal(float(i)*.25))*.004/(d*d + .002)*(.3 + abs(W[i]) + BEAT*.5); }
  col *= .8 + .4*E + .3*PK;
  col *= 1. - .3*dot(p,p) - .25*LY*smoothstep(.45,0.,abs(p.y+.05));
  o = vec4(post(aces(col*1.4), gl_FragCoord.xy), 1.);
}`);
