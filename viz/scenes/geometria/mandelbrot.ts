/**
 * Abismo de Mandelbrot: um mergulho sem fim num de quatro pontos fundos do
 * conjunto (muda a cada secção). Os graves empurram o mergulho, a batida dá
 * um soco no zoom, a queda faz as cores correr. Cores da capa nas bandas.
 */
import { HEAD, geoScene } from "./_lib";

export default geoScene({
  id: "mandelbrot",
  name: "Abismo de Mandelbrot",
  names: { en: "Mandelbrot abyss", lv: "Mandelbrota bezdibenis" },
  families: ["electronic", "calm"],
  tags: ["fractal", "matemática", "psicadélico", "hipnótico"],
  intensity: 3,
  cost: 2,
  signals: ["energy", "bass", "beat", "drop", "section", "palette"],
  lyrics: "neon",
}, HEAD + `
vec2 target(float k){
  k = mod(k, 4.);
  if(k < 1.) return vec2(-.235125, .827215);
  if(k < 2.) return vec2(.0016437220, -.8224676333);
  if(k < 3.) return vec2(-.7746806106, -.1374168856);
  return vec2(-.0452407411, .9868162204);
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float k = floor(SIDX + SEED*4.);
  vec2 c0 = target(k);
  // mergulho de ida e volta (a precisão de float acaba perto de 1e-4)
  float dive = sqrt(.5 - .5*cos(TZ*.22 + SEED*6.));
  float sc = .3*exp(-5.6*dive) * (1. - .1*KICK) * (1. - .25*SHIFT);
  p *= rot(TF*.05 + .3*sin(TZ*.1));
  vec2 c = c0 + p*sc;
  vec2 z = vec2(0.);
  float it = 0., trap = 1e9;
  float maxIt = Q > 2.5 ? 320. : Q > 1.5 ? 200. : 120.;
  for(int i=0;i<320;i++){
    if(float(i) >= maxIt) break;
    z = vec2(z.x*z.x - z.y*z.y, 2.*z.x*z.y) + c;
    float d = dot(z,z);
    trap = min(trap, abs(z.x*z.y));
    if(d > 256.){ break; }
    it += 1.;
  }
  vec3 col;
  if(it >= maxIt){
    // dentro: quase preto, com a armadilha a desenhar veios ténues
    col = C1*.06*smoothstep(.0,.3,sqrt(trap)) + vivid(C2)*.05*KICK;
  } else {
    float sm = it - log2(log2(dot(z,z))) + 4.;
    float f = log(sm)*.45 - TF*.05 - DROP*.5;
    vec3 neon = vivid(pal(f));
    float near = smoothstep(2., 45., sm);                 // perto da fronteira: luz
    float band = .5+.5*cos(sm*.4 - TF*1.6);
    col = neon * (.05 + .25*smoothstep(1.,12.,sm) + 1.*pow(near, 1.4));
    col += neon * pow(band, 10.) * near * (.4 + 1.4*BEAT + 1.5*DROP);
    col += vec3(1.) * pow(near, 6.) * (.3 + .7*KICK);
    col *= .8 + .5*E;
  }
  // vinheta e espaço para a letra
  float r = length(p);
  col *= 1. - .35*r*r - .25*LY*smoothstep(.45,0.,abs(p.y+.05));
  col = aces(col*1.25);
  o = vec4(post(col, gl_FragCoord.xy), 1.);
}`);
