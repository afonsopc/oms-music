/**
 * Polígonos encaixados: um túnel de polígonos uns dentro dos outros, cada um
 * roda um passo em cada batida com um atraso em relação ao de fora (uma
 * onda que entra para o centro). O número de lados muda no compasso.
 */
import { HEAD, geoScene } from "./_lib";

export default geoScene({
  id: "poligonos",
  name: "Polígonos encaixados",
  names: { en: "Nested polygons", lv: "Ligzdoti daudzstūri" },
  families: ["electronic", "calm"],
  tags: ["geométrico", "hipnótico", "minimal", "néon"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "beat", "bar", "drop", "section", "palette"],
  lyrics: "neon",
}, HEAD + `
float sdPoly(vec2 p, float n){
  float a = atan(p.x, p.y) + PI;
  float s = TAU/n;
  return cos(floor(.5 + a/s)*s - a)*length(p);
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float r = length(p);
  // zoom contínuo para dentro: cada camada tem um índice inteiro
  float z = TZ*.9 + TF*.05;
  float lr = log(max(r, 1e-4))/log(1.25) + z*2.;
  vec3 col = vec3(0.);
  float beats = BN + smoothstep(0., .35, BP);
  for(int k=0;k<3;k++){
    float layer = floor(lr) + float(k) - 1.;
    float n = 3. + mod(layer + BARN, 6.);
    float sc = pow(1.25, layer - z*2.);
    float ph = beats - layer*.12;
    float stepA = floor(ph) + smoothstep(0., 1., fract(ph));
    vec2 q = rot(stepA*TAU/(2.*n) + layer*.3) * p / sc;
    float d = sdPoly(q, n) - (1. + .08*KICK);
    float line = abs(d)*sc;
    float w = .0025 + .004*B;
    vec3 c = pal(layer*.13 + TF*.02);
    vec3 nc = vivid(c);
    col += nc * (smoothstep(w, 0., line) * 1.4 + .012/(line + .004) * (.25 + .6*BEAT + DROP));
    // um enchimento ténue alternado
  }
  col *= smoothstep(.0, .08, r) + .3*BEAT;
  col += vivid(C3)*exp(-r*12.)*(.3 + KICK);
  col *= .8 + .4*E + .3*PK;
  col *= 1. - .3*LY*smoothstep(.45,0.,abs(p.y+.05));
  o = vec4(post(aces(col), gl_FragCoord.xy), 1.);
}`);
