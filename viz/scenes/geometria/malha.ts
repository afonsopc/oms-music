/**
 * Malha gravitacional: o espaço-tempo como um tecido de arame, com três
 * astros nas cores da capa que o afundam. Os graves dão-lhes massa, cada
 * batida solta uma onda gravitacional que ondula a malha, e na queda
 * caem uns para os outros.
 */
import { HEAD, geoScene } from "./_lib";

export default geoScene({
  id: "malha",
  name: "Malha gravitacional",
  names: { en: "Gravity mesh", lv: "Gravitācijas tīkls" },
  families: ["electronic", "calm"],
  tags: ["espaço", "arame", "física", "néon"],
  intensity: 3,
  cost: 1,
  signals: ["energy", "bass", "beat", "drop", "section", "palette"],
  lyrics: "extrude",
}, HEAD + `
vec2 star(int i){
  float fi = float(i);
  float r = (.9 + .35*fi) * (1. - .5*DROP);
  float a = TF*(.25 - .06*fi) + fi*2.1 + SEED*6.;
  return vec2(cos(a), sin(a))*r;
}
float mass(int i){ return (.35 + .25*float(i==0) + .5*B + .3*PK) ; }
float well(vec2 x){
  float h = 0.;
  for(int i=0;i<3;i++){
    vec2 d = x - star(i);
    h -= mass(i)/(1. + dot(d,d)*4.);
  }
  float r = length(x);
  h += .08*sin(r*6. - BP*14.)*BEAT*exp(-r*.3);
  return h;
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  // câmara inclinada sobre o plano
  float tilt = .55 + .1*sin(TF*.05);
  vec3 ro = vec3(0., 2.2, -3.2);
  ro.xz = rot(TF*.03)*ro.xz;
  vec3 fw = normalize(vec3(0., -.2, 0.) - ro), rt = normalize(cross(fw, vec3(0,1,0))), up = cross(rt, fw);
  vec3 rd = normalize(p.x*rt + p.y*up + 1.3*fw);
  // marcha curta contra a superfície deformada
  float t = (0. - ro.y)/rd.y;
  vec3 col = vec3(0.);
  if(rd.y < 0.){
    t = (-.0 - ro.y)/rd.y * .7;
    for(int i=0;i<24;i++){
      vec3 q = ro + rd*t;
      float d = q.y - well(q.xz);
      t += d*.6;
    }
    vec3 q = ro + rd*t;
    vec2 g = q.xz*3.;
    vec2 fg = abs(fract(g) - .5);
    vec2 wg = fwidth(g)*1.2;
    float line = max(smoothstep(wg.x, 0., fg.x - .0), smoothstep(wg.y, 0., fg.y));
    float depth = -well(q.xz);
    vec3 tint = mix(vivid(C2), vivid(C3), clamp(depth*.9, 0., 1.));
    float fade = exp(-t*.12);
    col += tint*line*fade*(.5 + .9*depth + .6*BEAT);
    col += vivid(C1)*.04*fade;
    tilt += 0.;
  }
  // os astros
  for(int i=0;i<3;i++){
    vec2 s = star(i);
    vec3 sp = vec3(s.x, -mass(i)*.8 + .25, s.y);
    vec3 oc = sp - ro;
    float along = dot(oc, rd);
    float dd = length(oc - rd*along);
    float rr = .16 + .08*mass(i) + .05*KICK;
    vec3 c = vivid(i==0 ? C1 : i==1 ? C2 : C3);
    col += c*(smoothstep(rr, rr*.85, dd)*1.2 + .02/(dd*dd + .002)*(.15 + .3*BEAT + .5*DROP));
  }
  col *= .8 + .4*E;
  col *= 1. - .3*LY*smoothstep(.45,0.,abs(p.y+.05));
  o = vec4(post(aces(col), gl_FragCoord.xy), 1.);
}`);
