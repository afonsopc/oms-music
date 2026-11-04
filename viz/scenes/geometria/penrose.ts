/**
 * Mosaico de Penrose: o ladrilho que nunca se repete, gerado por subdivisão
 * de triângulos de ouro, num zoom sem fim para o centro (o sol de cinco
 * pontas). Uma onda de luz corre pelos losangos em cada batida, os grossos
 * e os finos com cores diferentes; na queda roda um décimo de volta.
 */
import { HEAD, geoScene } from "./_lib";

export default geoScene({
  id: "penrose",
  name: "Mosaico de Penrose",
  names: { en: "Penrose tiling", lv: "Penrouza mozaīka" },
  families: ["calm", "electronic"],
  tags: ["ladrilhos", "matemática", "quasicristal", "simetria"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "beat", "bar", "drop", "section", "palette"],
  lyrics: "ink",
}, HEAD + `
#define PHI 1.6180339887
float cross2(vec2 a, vec2 b){ return a.x*b.y - a.y*b.x; }
bool inTri(vec2 p, vec2 a, vec2 b, vec2 c){
  float d1 = cross2(b-a, p-a), d2 = cross2(c-b, p-b), d3 = cross2(a-c, p-c);
  return !((d1 < 0. || d2 < 0. || d3 < 0.) && (d1 > 0. || d2 > 0. || d3 > 0.));
}
float seg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  // zoom de PHI^2 em PHI^2 (o padrão do centro repete-se)
  float z = fract(TZ*.12 + TF*.015);
  float sc = pow(PHI*PHI, -z) * (1. - .05*KICK);
  float spin = floor(SIDX)*PI/5. + .04*sin(TF*.1);
  vec2 q = rot(spin)*p*sc*.9;
  // a roda de 10 triângulos: em qual cai o ponto
  float ang = atan(q.y, q.x);
  float i = floor(mod((ang + PI/10.)/(PI/5.), 10.));
  vec2 A = vec2(0.);
  vec2 B = vec2(cos((2.*i-1.)*PI/10.), sin((2.*i-1.)*PI/10.))*1.4;
  vec2 C = vec2(cos((2.*i+1.)*PI/10.), sin((2.*i+1.)*PI/10.))*1.4;
  if(mod(i, 2.) < 1.){ vec2 t = B; B = C; C = t; }
  float type = 0.;
  float levels = Q > 1.5 ? 7. : 6.;
  for(int l=0;l<7;l++){
    if(float(l) >= levels) break;
    if(type < .5){
      vec2 P = A + (B - A)/PHI;
      if(inTri(q, C, P, B)){ vec2 a0 = C; A = a0; C = B; B = P; type = 0.; }
      else { vec2 a0 = P; B = C; C = A; A = a0; type = 1.; }
    } else {
      vec2 Qp = B + (A - B)/PHI, Rp = B + (C - B)/PHI;
      if(inTri(q, Rp, C, A)){ vec2 c0 = A; B = C; A = Rp; C = c0; type = 1.; }
      else if(inTri(q, Qp, Rp, B)){ vec2 c0 = B; A = Qp; B = Rp; C = c0; type = 1.; }
      else { vec2 c0 = A; A = Rp; B = Qp; C = c0; type = 0.; }
    }
  }
  float px = sc*.9/R.y;
  float d = min(seg(q, C, A), seg(q, A, B));
  vec2 cen = .5*(B + C);
  float h = hash(floor(cen*400.));
  float rr = length(cen)/sc;
  // a onda da batida corre do centro para fora
  float wave = exp(-pow(rr*3. - BP*4., 2.)*2.)*BEAT;
  float star = step(.9 - .15*PK, hash(floor(cen*400.) + BARN));
  vec3 thick = mix(C1, vivid(C2), .3 + .2*h), thin = mix(vivid(C3), C2, .2*h);
  vec3 fill = type < .5 ? thin : thick;
  // sombreado em gradiente dentro do losango (dá relevo)
  float inner = clamp(d/(length(B - C)*.5), 0., 1.);
  vec3 col = fill*(.18 + .5*inner + .9*wave + .7*star*(.4 + .6*BEAT) + .3*E);
  float edge = smoothstep(px*2.5*(1. + 2.*KICK), 0., d);
  col = mix(col, vec3(.02), edge*.85);
  col += vivid(mix(C2, C3, h))*exp(-d/px*.25)*(.12 + .4*KICK + DROP);
  col *= 1. - .3*dot(p,p) - .25*LY*smoothstep(.45,0.,abs(p.y+.05));
  o = vec4(post(aces(col*1.3), gl_FragCoord.xy), 1.);
}`);
