/**
 * Julia: o parâmetro anda pela fronteira do cardióide (os médios empurram-no),
 * por isso o conjunto passa de rendas ligadas a poeira e volta. A batida
 * aproxima, a queda atira-o para fora e ele estilhaça. Brilho por armadilha
 * de órbitas, nas cores da capa.
 */
import { HEAD, geoScene } from "./_lib";

export default geoScene({
  id: "julia",
  name: "Julia",
  names: { en: "Julia", lv: "Džulija" },
  families: ["electronic", "calm"],
  tags: ["fractal", "matemática", "simetria", "hipnótico"],
  intensity: 3,
  cost: 2,
  signals: ["energy", "bass", "mid", "beat", "drop", "section", "palette"],
  lyrics: "ink",
}, HEAD + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float a = TF*.045 + SEED*TAU + .9*M + SG*1.7;
  vec2 e = vec2(cos(a), sin(a));
  // a fronteira do cardióide principal, um pouco para dentro ou para fora
  vec2 c = .5*e - .25*vec2(e.x*e.x-e.y*e.y, 2.*e.x*e.y);
  c *= 1.005 + .04*sin(TF*.13) + .07*DROP + .02*KICK;
  vec2 z = rot(TF*.03)*p * (2.5 - .35*KICK - .3*PK);
  float maxIt = Q > 1.5 ? 140. : 90.;
  float it = 0., tp = 1e9, tl = 1e9;
  for(int i=0;i<140;i++){
    if(float(i) >= maxIt) break;
    z = vec2(z.x*z.x - z.y*z.y, 2.*z.x*z.y) + c;
    tp = min(tp, length(z - .3*e));
    tl = min(tl, abs(z.y + .1*sin(TF*.2)));
    if(dot(z,z) > 64.) break;
    it += 1.;
  }
  float inside = step(maxIt, it);
  float sm = it - log2(log2(max(dot(z,z),1.0001))) ;
  float glowP = exp(-tp*(9. - 4.*B));
  float glowL = exp(-tl*28.);
  vec3 a1 = vivid(C1), a2 = vivid(C2), a3 = vivid(C3);
  vec3 col = vec3(0.);
  float edge = smoothstep(0., maxIt*.5, sm) * (1.-inside);
  col += mix(a1, a2, .5+.5*sin(sm*.15 - TF*.6)) * pow(edge, 1.6) * .8;
  col += a3 * glowL * (.25 + .9*H) * (1.-inside);
  col += mix(a2, vec3(1.), .4) * glowP * (.4 + 1.2*BEAT + DROP);
  col += inside * (C1*.08 + a3*glowP*.4);
  col *= .75 + .5*E + .4*PK;
  float r = length(p);
  col *= 1. - .4*r*r - .2*LY*smoothstep(.4,0.,abs(p.y+.05));
  o = vec4(post(aces(col*1.2), gl_FragCoord.xy), 1.);
}`);
