/**
 * Nuvens em timelapse: o céu sobre um vale, as nuvens a correr como num
 * filme acelerado, com volume e luz do sol a atravessá-las, e as sombras
 * delas a passar pelos campos. A energia acelera o tempo; cada secção é
 * uma hora do dia diferente (madrugada, meio-dia, pôr-do-sol, noite) e nas
 * quedas o tempo dispara.
 */
import { SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

export default natShader({
  id: "nuvens",
  name: "Nuvens em timelapse",
  names: { en: "Timelapse clouds", lv: "Mākoņi paātrināti" },
  families: ["calm", "electronic"],
  tags: ["natureza", "céu", "suave", "dia"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "beat", "drop", "section", "palette"],
  lyrics: "extrude",
}, NAT_GLSL + `
float clouds(vec2 q, float t){
  vec2 w = q + vec2(t, 0.);
  float n = fbm(w*.9 + .3*fbm(w*.6 - t*.15));
  return smoothstep(.34 - .1*U[0].z, .72, n);
}
void main(){
  vec2 p = (pixuv(uv) - .5)*vec2(R.x/R.y, 1.);
  float t = U[0].x, day = U[0].y;     // day: 0 madrugada, .33 meio-dia, .66 pôr-do-sol, 1 noite
  float sunA = day*3.1416;
  vec2 sun = vec2(cos(sunA)*.8, -.1 + sin(sunA)*.5);
  float night = smoothstep(.7, .95, day);
  float dusk = exp(-pow((day - .66)*5., 2.)) + exp(-pow(day*5., 2.));
  vec3 zen = mix(mix(vec3(.15,.35,.75), vivid(C3)*.6, .45), vivid(C3)*.03, night);
  vec3 hor = mix(mix(vec3(.75,.85,.95), vivid(C1), .4), mix(vivid(C1), vec3(1.,.5,.2), .3)*1.2, dusk);
  hor = mix(hor, vivid(C3)*.08, night);
  float hz = -.18;
  vec3 col = mix(hor, zen, smoothstep(hz, .5, p.y));
  vec3 sc = mix(vec3(1., .95, .85), mix(vivid(C2), vec3(1., .55, .25), .4), dusk);
  float sd = length(p - sun);
  col += sc*(smoothstep(.05, .045, sd)*2. + .3*exp(-sd*6.))*(1. - night);
  // estrelas e lua de noite
  vec2 stp = floor(p*170.);
  col += step(.996, hash(stp))*night*smoothstep(hz, .2, p.y)*.8;
  vec2 moon = vec2(-.5, .3);
  col += vec3(.9,.92,1.)*smoothstep(.035, .03, length(p - moon))*night;
  // nuvens: projectadas num plano de céu, com luz a atravessar
  if(p.y > hz){
    float z = 1./(p.y - hz + .25);
    vec2 q = vec2(p.x*z, z*2.5)*.55;
    float c = clouds(q, t);
    vec2 toSun = normalize(vec2(sun.x - p.x, .3))*.15;
    float c2 = clouds(q + toSun, t);
    float lit = clamp(.9 - (c2 - c)*6. - c2*.5, 0., 1.);
    vec3 cc = mix(mix(vec3(.16,.17,.24), vivid(C3)*.3, .4)*(1. - night*.85), sc*(1.25 - night*.9), lit);
    cc += sc*.6*smoothstep(.05, .0, c)*smoothstep(.0, .02, c)*(1. - night);
    cc += sc*pow(max(0., 1. - sd), 6.)*(1. - c)*.6*(1. - night);
    float fadeH = smoothstep(hz, hz + .08, p.y);
    col = mix(col, cc, c*fadeH);
  }
  // o vale: colinas com as sombras das nuvens a passar
  float h1 = hz - .02 + .06*fbm(vec2(p.x*2. + 4., 1.));
  float h2 = hz - .14 + .08*fbm(vec2(p.x*1.4 + 9., 3.));
  if(p.y < h1){
    float z = 1./(hz - p.y + .15);
    vec2 g = vec2(p.x*z, z*2.)*.6;
    float shadow = clouds(g*.8 + vec2(3., 0.), t);
    vec3 grass = mix(vec3(.2,.38,.12), vivid(C1)*.5, .35)*(.4 + .6*(1. - night))*(1. - night*.85);
    grass *= mix(1.15, .45, shadow);
    grass = mix(grass, hor*.5, smoothstep(h1 - .1, h1, p.y)*.5);
    if(p.y < h2){ grass *= .7; grass = mix(grass, grass*mix(1.2, .5, shadow), .5); }
    col = grass*(1. + dusk*.4*sc);
  }
  col += sc*(.06*BEAT + .25*DROP)*(1. - night);
  col *= 1. - .25*dot(p, p);
  o = vec4(post(aces(col*1.1), gl_FragCoord.xy), 1.);
}`, {
  scale: 0.75,
  state: () => {
    const sec = new SectionEdge();
    let clock = 0, day = 0.3, target = 0.3, speed = 0, cover = 0, first = true;
    const hours = [0.05, 0.3, 0.45, 0.66, 0.92, 0.2, 0.75, 0.55];
    return (u, _t, s, dt) => {
      if (first) { first = false; target = day = hours[Math.max(0, s.sectionIndex) % hours.length]; }
      if (sec.hit(s)) target = hours[Math.max(0, s.sectionIndex) % hours.length];
      day += (target - day) * Math.min(1, dt * 0.35);
      const want = 0.06 + 0.25 * s.energy + 0.8 * s.drop;
      speed += (want - speed) * Math.min(1, dt * 2);
      clock += dt * speed;
      cover += (s.sectionIntensity - cover) * Math.min(1, dt * 0.5);
      u[0] = clock; u[1] = day; u[2] = cover;
    };
  },
});
