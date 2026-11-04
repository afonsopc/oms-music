/**
 * Bambual: um bosque de bambus em camadas, com nevoeiro entre elas e luz a
 * entrar de lado. Os caules são molas: o vento dos graves dobra-os, cada
 * batida dá um empurrão e eles balançam e voltam. Nas quedas passa uma
 * rajada forte que arranca folhas e as leva pelo ar.
 */
import { BeatEdge, SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

export default natShader({
  id: "bambual",
  name: "Bambual",
  names: { en: "Bamboo grove", lv: "Bambusu birzs" },
  families: ["calm", "electronic"],
  tags: ["natureza", "vento", "verde", "suave", "floresta"],
  intensity: 2,
  cost: 1,
  signals: ["bass", "beat", "drop", "section", "palette"],
  lyrics: "ink",
}, NAT_GLSL + `
void main(){
  vec2 p = (pixuv(uv) - .5)*vec2(R.x/R.y, 1.);
  float sway = U[0].x, gust = U[0].y, leafT = U[0].z;
  vec3 green = mix(vec3(.35,.6,.25), vivid(C1), .4);
  vec3 light = mix(vivid(C2), vec3(1., .95, .75), .45);
  vec3 col = mix(green*.55 + light*.2, vivid(C3)*.08, smoothstep(-.6, .7, p.y));
  col += light*.35*exp(-length(p - vec2(.55, .45))*2.);
  // cinco camadas, do fundo (claras, nevoeiro) para a frente (escuras)
  for(int l=0;l<5;l++){
    float fl = float(l);
    float dens = 5. + fl*1.2;
    float scl = 1. + fl*.35;
    float y = p.y + .5;
    float bend = sway*(.6 + fl*.25) + .01*sin(T*(.7 + fl*.13) + fl);
    float xs = p.x*dens/scl + fl*3.7 - bend*y*y*dens/scl;
    float id = floor(xs);
    float h = hash1(id*1.3 + fl*7.);
    float fx = fract(xs) - .5 - (h - .5)*.5;
    float wdt = (.055 + .04*h)*scl;
    float stalk = step(.15, h)*smoothstep(wdt, wdt*.7, abs(fx));
    // nós do bambu
    float seg = .14 + .08*h;
    float ny = fract(y/seg + h*4.);
    float node = smoothstep(.03, .0, abs(ny - .5))*.5;
    float shade = .55 + .45*smoothstep(-wdt, wdt, fx);
    float fog = exp(-fl*.55);
    vec3 sc = mix(green*(.35 + .1*fl), green*.05, fl/4.);
    sc *= shade*(1. - node*.6);
    sc += light*.25*smoothstep(wdt*.2, wdt, fx)*(1. - fl/5.);
    sc = mix(sc, col, fog*.65);
    col = mix(col, sc, stalk);
    // folhas: feixes a sair dos nós de cima
    float lx = p.x*dens*.6 + fl*5. - bend*y*y*dens*.6;
    vec2 lq = vec2(lx*1.6, y*9.) + vec2(0., fl*3.);
    vec2 lid = floor(lq), lf = fract(lq) - .5;
    vec2 lh = hash2(lid + fl*9.);
    lf -= (lh - .5)*.3;
    lf = rot(-.9 + .5*lh.x + (lh.y > .5 ? 2.2 : 0.) - sway*2.)*lf;
    lf.x -= .25;
    float lshape = length(lf*vec2(1., 4.2)) - .3 + .1*lf.x;
    float leaf = smoothstep(.02, -.02, lshape)*step(.5, y + .15*lh.y)*step(.35, lh.x);
    col = mix(col, sc*.8 + light*.08*(1. - fl/5.), leaf*.85);
  }
  // folhas arrancadas pela rajada
  if(gust > .01){
    for(int l=0;l<2;l++){
      vec2 q = p*(6. - float(l)*2.) + vec2(-leafT*(3. + float(l)*2.), leafT*.5 + float(l)*4.);
      q.y += .4*sin(q.x*.7 + leafT);
      vec2 id = floor(q), f = fract(q) - .5;
      vec2 h = hash2(id);
      f = rot(leafT*5.*(h.x - .5) + h.y*6.)*f;
      float d = length(f*vec2(1., 3.5)) - .14;
      col = mix(col, green*.25 + light*.15, smoothstep(.01, -.01, d)*step(.6, h.x)*gust);
    }
  }
  col *= 1. - .3*dot(p, p);
  o = vec4(post(aces(col*1.2), gl_FragCoord.xy), 1.);
}`, {
  state: () => {
    const beat = new BeatEdge();
    const sec = new SectionEdge();
    // uma mola amortecida: o vento empurra, o caule volta
    let pos = 0, vel = 0, gust = 0, leafT = 0;
    return (u, t, s, dt) => {
      if (beat.hit(s)) vel += 0.05 + 0.12 * s.bass;
      if (sec.hit(s) && sec.big) { vel += 0.45; gust = 1; }
      const force = 0.03 + 0.08 * s.bass * s.sectionIntensity + 0.04 * Math.sin(t * 0.35) + 0.12 * gust;
      const acc = (force - pos) * 14 - vel * 2.2;
      vel += acc * dt;
      pos += vel * dt;
      gust *= Math.exp(-dt * 0.6);
      leafT += dt * (0.3 + 1.2 * gust);
      u[0] = pos; u[1] = gust; u[2] = leafT;
    };
  },
});
