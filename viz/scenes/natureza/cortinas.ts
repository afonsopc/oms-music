/**
 * Cortinas boreais: a aurora a sério. Véus de luz pendurados no céu, com
 * as estrias verticais e o bordo de baixo aceso, que se dobram sobre si
 * mesmos (onde a dobra volta, a luz soma-se), por cima de um lago gelado
 * que os reflecte. Os graves fazem as cortinas dançar, a
 * batida acende-as, e nas quedas uma onda de luz corre-as de ponta a ponta.
 * Nada a ver com o fundo "Aurora" (manchas suaves): aqui há cortinas.
 */
import { Envelope, SectionEdge } from "../../lib/beat";
import { NAT_GLSL, natShader } from "./_lib";

export default natShader({
  id: "cortinas",
  name: "Cortinas boreais",
  names: { en: "Northern curtains", lv: "Ziemeļblāzmas aizkari" },
  families: ["calm", "electronic"],
  tags: ["natureza", "noite", "céu", "inverno", "suave"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "beat", "drop", "section", "palette"],
  lyrics: "neon",
}, NAT_GLSL + `
vec3 curtains(vec2 p, float refl){
  float t = U[0].x, wave = U[0].y, wx = U[0].z;
  vec3 acc = vec3(0.);
  for(int k=0;k<4;k++){
    float fk = float(k);
    // a cortina dobra-se: x deformado; onde a dobra volta para trás, a luz soma-se
    float f1 = 2.4 + fk*.6, a1 = .48 + .12*B;
    float ph = p.x*f1 + t*(.35 + fk*.1) + fk*2.1;
    float fold = p.x + a1*sin(ph) + .08*sin(p.x*3.7 - t*.6 + fk);
    float dfd = abs(1. + a1*f1*cos(ph) + .08*3.7*cos(p.x*3.7 - t*.6 + fk));
    float bright = clamp(.3/(dfd + .08), 0., 3.5);
    float base = -.02 + fk*.08 + .1*sin(p.x*.8 + t*.2 + fk*1.3) + .04*sin(fold*2.5 + t*.5);
    float y = p.y - base;
    float hgt = .16 + .08*fk + .12*noise(vec2(fold*3., t*.1 + fk));
    float rays = noise(vec2(fold*38. + fk*10., t*.25))*.7 + noise(vec2(fold*90., t*.4 + fk))*.3;
    rays = .35 + .9*pow(rays, 1.5);
    float fade = y > 0. ? exp(-y/hgt*2.) : exp(y*60.);
    float lower = y > 0. ? exp(-y*25.)*.8 : 0.;
    vec3 c = mix(vivid(C1), vivid(C2), smoothstep(.0, hgt*.6, y));
    c = mix(c, vivid(C3)*1.2, smoothstep(hgt*.4, hgt*1.2, y));
    float run = exp(-pow(fold - wx, 2.)*3.)*wave;
    float side = smoothstep(1.4, .3, abs(p.x + .3*sin(fk*2. + t*.05) - (fk - 1.5)*.5));
    acc += c*(fade + lower)*rays*bright*side*(.3 - fk*.04)*(1. + 3.*run);
    acc += c*.02*exp(-abs(y)*4.)*side;
  }
  return acc;
}
void main(){
  vec2 p = (pixuv(uv) - .5)*vec2(R.x/R.y, 1.);
  float hz = -.28;
  vec3 col = mix(vivid(C3)*.07, vec3(.0,.004,.015), smoothstep(-.4, .5, p.y));
  float mount = hz + .05 + .08*fbm(vec2(p.x*1.8 + 3., 1.)) + .03*noise(vec2(p.x*9., 2.));
  // pinheiros à frente
  float px = p.x*14.;
  float id = floor(px), fx = fract(px) - .5;
  float th = hash1(id*3.7);
  float hgt = .05 + .12*th;
  float jag = .5 + .5*fract((p.y + .5)*(40. - 20.*th));
  float tree = -.45 + hgt*(1. - abs(fx)*(2.1 + .8*jag));
  float ground = max(th < .3 ? -1. : tree, -.46 + .015*sin(p.x*5.));
  if(p.y > ground && p.y > hz){
    vec2 sp = floor(p*170.);
    col += step(.995, hash(sp))*(.4 + .4*sin(T*2. + hash(sp)*40.));
    vec3 au = curtains(p, 0.);
    if(p.y > mount) col += au*(.8 + .4*E + .5*BEAT);
    else {
      float snow = smoothstep(mount - .03, mount, p.y + .015*noise(vec2(p.x*30., p.y*30.)));
      col = vivid(C3)*.02 + vivid(C1)*.05*snow + au*.04;
    }
  } else if(p.y > ground){
    // o lago reflecte as cortinas
    vec2 rp = vec2(p.x + .006*sin(p.y*90. + T*1.5), 2.*hz - p.y + .02);
    col = curtains(rp, 1.)*(.35 + .2*E) + vec3(.0,.006,.012);
  } else {
    col = vec3(.0,.003,.006);
  }
  col += U[0].w*vivid(C2)*.08;
  col *= 1. - .25*dot(p, p);
  o = vec4(post(aces(col*1.3), gl_FragCoord.xy), 1.);
}`, {
  state: () => {
    const sec = new SectionEdge();
    const wave = new Envelope(0.05, 2.5);
    let clock = 3, wx = -3;
    return (u, _t, s, dt) => {
      clock += dt * (0.25 + 0.6 * s.bass + 0.5 * s.drop);
      if (sec.hit(s) && sec.big) { wave.kick(1); wx = -2.5; }
      wave.step(0, dt);
      wx += dt * 3;
      u[0] = clock; u[1] = wave.v; u[2] = wx; u[3] = s.drop;
    };
  },
});
