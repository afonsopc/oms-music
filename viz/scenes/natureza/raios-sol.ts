/**
 * Raios de sol: debaixo da copa de um bosque, o sol a furar as folhas em
 * feixes de luz, e pólen a flutuar e a cintilar quando passa por eles.
 * A copa mexe com os graves (e os feixes com ela), o pólen cintila nos
 * agudos e salta na batida; nas quedas a copa abre-se e a luz inunda tudo.
 */
import { Envelope, SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

export default natShader({
  id: "raios-sol",
  name: "Raios de sol",
  names: { en: "Sunbeams", lv: "Saules stari" },
  families: ["calm"],
  tags: ["natureza", "floresta", "luz", "dia", "suave", "primavera"],
  intensity: 1,
  cost: 1,
  signals: ["bass", "high", "beat", "drop", "section", "palette"],
  lyrics: "ink",
}, NAT_GLSL + `
float canopy(vec2 p, float open){
  // 1 = folha, 0 = buraco por onde passa o sol
  float sw = U[0].x;
  vec2 q = p*3. + vec2(sw*.4, sw*.2);
  float n = .55*noise(q) + .3*noise(q*2.1 + 3.) + .15*noise(q*4.3 + 7.) + .2*noise(q*8.7);
  return smoothstep(.3 + .2*open, .46 + .2*open, n);
}
void main(){
  vec2 p = (pixuv(uv) - .5)*vec2(R.x/R.y, 1.);
  float open = U[0].y;
  vec3 sun = mix(vec3(1., .92, .7), vivid(C2), .4);
  vec3 green = mix(vec3(.18,.32,.12), vivid(C1)*.5, .4);
  vec3 col = mix(green*.5, vivid(C3)*.06 + green*.15, smoothstep(.5, -.5, p.y));
  // feixes: amostrar a copa ao longo da linha até ao sol (lá em cima)
  vec2 src = vec2(.35, 1.1);
  vec2 dir = src - p;
  float acc = 0.;
  float jit = hash(gl_FragCoord.xy)*.06;
  for(int i=0;i<8;i++){
    float k = (float(i)/8. + jit*1.3);
    vec2 sp = p + dir*k*.9;
    if(sp.y < .2) continue;
    acc += 1. - canopy(sp*.6 + vec2(0., .5), open);
  }
  acc /= 8.;
  float beam = pow(acc, 2.2)*(1.2 + 1.2*open);
  col += sun*beam*(.7 + .3*B)*smoothstep(-.8, .3, p.y + .3);
  // a copa lá em cima
  float top = smoothstep(.15, .45, p.y);
  float cn = canopy(p*.6 + vec2(0., .5), open);
  col = mix(col, green*(.1 + .25*(1. - cn)) + sun*(1. - cn)*.9, top*(.6 + .4*cn));
  // troncos
  for(int i=0;i<4;i++){
    float fi = float(i);
    float x = -.75 + fi*.5 + .1*sin(fi*3.);
    float w = .035 + .02*hash1(fi);
    float m = smoothstep(w, w*.8, abs(p.x - x + .05*p.y));
    col = mix(col, green*.06 + sun*.08*smoothstep(0., w, p.x - x)*beam, m*(.75 + fi*.06));
  }
  // pólen
  for(int l=0;l<3;l++){
    float fl = float(l);
    vec2 q = p*(7. + fl*5.) + vec2(T*.05*(1. + fl), -T*.03 + fl*3.) + U[0].z*.3*(1. + fl);
    vec2 id = floor(q), f = fract(q) - .5;
    vec2 h = hash2(id + fl*5.);
    vec2 c = (h - .5)*.6 + .15*vec2(sin(T*(.4 + h.x) + h.y*20.), cos(T*(.3 + h.y) + h.x*20.));
    float d = length(f - c);
    float tw = .6 + .4*sin(T*(3. + 5.*h.y) + h.x*40.);
    float s = smoothstep(.07 - fl*.015, .0, d)*step(.45, h.x)*(.25 + beam*2.5)*(tw + 1.5*H*step(.8, h.y));
    col += sun*s*(.6 + .5*BEAT);
  }
  col += sun*DROP*.15;
  col *= 1. - .28*dot(p, p);
  o = vec4(post(aces(col*1.15), gl_FragCoord.xy), 1.);
}`, {
  scale: 0.6,
  state: () => {
    const sec = new SectionEdge();
    const open = new Envelope(0.5, 3);
    let sw = 0, lift = 0, liftV = 0, base = 0.3;
    return (u, _t, s, dt) => {
      if (sec.hit(s) && sec.big) open.kick(1);
      open.step(0, dt);
      base += (0.2 + 0.4 * s.sectionIntensity - base) * Math.min(1, dt * 0.5);
      sw += dt * (0.08 + 0.4 * s.bass);
      liftV += (s.beat * 0.4 - liftV) * Math.min(1, dt * 8);
      lift += liftV * dt;
      u[0] = sw + Math.sin(sw * 3) * 0.05; u[1] = Math.min(1, 0.3 + base * 0.4 + open.v * 0.5); u[2] = lift;
    };
  },
});
