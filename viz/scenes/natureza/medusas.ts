/**
 * Medusas: alforrecas bioluminescentes no fundo do mar, translúcidas, nas
 * cores da capa. A cada batida contraem a campânula e dão um impulso para
 * cima (os graves dão a força); os tentáculos ondulam atrás. Nas quedas
 * acendem-se todas de uma vez e a neve marinha à volta cintila.
 */
import { BeatEdge, Envelope, SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

const J = 6;

export default natShader({
  id: "medusas",
  name: "Medusas",
  names: { en: "Jellyfish", lv: "Medūzas" },
  families: ["calm", "electronic"],
  tags: ["natureza", "mar", "água", "escuro", "suave", "néon"],
  intensity: 2,
  cost: 1,
  signals: ["bass", "high", "beat", "drop", "section", "palette"],
  lyrics: "neon",
}, NAT_GLSL + `
vec3 jelly(vec2 p, vec4 j, float k, inout float alpha){
  vec2 lp = (p - j.xy)/j.z;
  if(abs(lp.x) > 1.2 || lp.y > .8 || lp.y < -2.6) return vec3(0.);
  float pulse = j.w;
  lp = rot(.15*sin(T*.5 + k*2.))*lp;
  vec3 c1 = vivid(pal(k*.27));
  vec3 c2 = mix(c1, vec3(1.), .5);
  vec3 col = vec3(0.);
  // campânula: meia elipse com o bordo recortado
  float w = .5*(1. - .22*pulse), hh = .42*(1. + .18*pulse);
  vec2 e = lp/vec2(w, hh);
  float r = length(e);
  float ang = atan(lp.x, lp.y);
  float rim = -.08 + .03*cos(ang*16.);
  float bell = smoothstep(1., .96, r)*smoothstep(rim - .02, rim + .04, lp.y);
  if(bell > 0.){
    float fr = pow(r, 3.);
    col += c1*bell*(.18 + .9*fr);
    float org = smoothstep(.3, .1, abs(length(lp*vec2(1., 1.6) - vec2(0., .14)) - .14))*.5;
    col += c2*org*bell*(.5 + .5*pulse);
    col += c2*bell*smoothstep(.85, 1., r)*.6;
    alpha = max(alpha, bell*.5);
  }
  // tentáculos
  if(lp.y < .02){
    float y = -lp.y;
    for(int i=0;i<7;i++){
      float fi = float(i);
      float x0 = (fi/6. - .5)*.8*w*2.;
      float len = 1.6 + .8*hash1(fi + k*10.);
      if(y > len) continue;
      float wv = .1*sin(y*6. - T*3. + fi*1.7 + k)*y + .05*sin(y*13. - T*5. + fi)*y;
      float d = abs(lp.x - x0*(1. - y*.15) - wv);
      float th = .012*(1. - y/len) + .004;
      col += c1*(smoothstep(th, 0., d)*.9 + .2*exp(-d*30.))*(1. - y/len);
    }
    // braços orais
    for(int i=0;i<2;i++){
      float fi = float(i);
      float wv = .12*sin(y*4. - T*2. + fi*3. + k)*y;
      float d = abs(lp.x - (fi - .5)*.12 - wv);
      float th = .05*(1. - y/1.3)*(.7 + .3*sin(y*30.));
      col += c2*smoothstep(th, th*.3, d)*step(y, 1.3)*.35;
    }
  }
  return col;
}
void main(){
  vec2 p = (pixuv(uv) - .5)*vec2(R.x/R.y, 1.);
  float glow = U[6].x;
  vec3 col = mix(vivid(C3)*.08, vec3(0.,.005,.015), smoothstep(.5, -.5, p.y));
  col += vivid(C2)*.06*exp(-length(p - vec2(.1, .6))*2.);
  // neve marinha
  for(int l=0;l<2;l++){
    vec2 q = p*(14. + float(l)*12.) + vec2(0., T*.05*(1. + float(l))) + float(l)*9.;
    vec2 id = floor(q), f = fract(q) - .5;
    vec2 h = hash2(id);
    float d = length(f - (h - .5)*.6);
    col += vec3(.7,.8,.9)*smoothstep(.06, .0, d)*step(.6, h.x)*(.15 + .5*H*step(.85, h.y) + .5*glow);
  }
  float a = 0.;
  vec3 acc = vec3(0.);
  for(int i=0;i<${J};i++) acc += jelly(p, U[i], float(i), a);
  col = col*(1. - a*.5) + acc*(.8 + .5*BEAT + 1.2*glow);
  col *= 1. - .3*dot(p, p);
  o = vec4(post(aces(col*1.2), gl_FragCoord.xy), 1.);
}`, {
  state: () => {
    const beat = new BeatEdge();
    const sec = new SectionEdge();
    const glow = new Envelope(0.02, 1.5);
    const x = new Float32Array(J), y = new Float32Array(J), vy = new Float32Array(J), sz = new Float32Array(J), pl = new Float32Array(J);
    let A = 1.78, beats = 0;
    for (let i = 0; i < J; i++) { x[i] = (i / (J - 1) - 0.5) * 1.4 + (Math.random() - 0.5) * 0.15; y[i] = (Math.random() - 0.5) * 0.8; sz[i] = 0.08 + Math.random() * 0.1; }
    return (u, t, s, dt, _env, w, h) => {
      A = w / h;
      if (sec.hit(s) && sec.big) glow.kick(1);
      glow.step(0, dt);
      if (beat.hit(s)) {
        beats++;
        // metade das medusas em cada batida, alternadas
        for (let i = beats & 1; i < J; i += 2) { pl[i] = 1; vy[i] += (0.03 + 0.08 * s.bass) * (0.6 + sz[i] * 3); }
      }
      for (let i = 0; i < J; i++) {
        pl[i] *= Math.exp(-dt * 4);
        vy[i] = vy[i] * Math.exp(-dt * 1.5) - dt * 0.012;
        y[i] += vy[i] * dt;
        x[i] += Math.sin(t * 0.2 + i * 2) * 0.01 * dt;
        if (y[i] > 0.5 + sz[i] * 0.9) { y[i] = -0.5 - sz[i] * 2.6; x[i] = (Math.random() - 0.5) * (A - 0.3); sz[i] = 0.08 + Math.random() * 0.12; }
        if (y[i] < -0.5 - sz[i] * 2.8) y[i] = 0.5;
        u[i * 4] = x[i]; u[i * 4 + 1] = y[i]; u[i * 4 + 2] = sz[i]; u[i * 4 + 3] = pl[i];
      }
      u[24] = glow.v;
    };
  },
});
