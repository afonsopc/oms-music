/**
 * Lasers de festival: três leques a varrer o fumo por cima da multidão,
 * o ecrã do palco com a capa, braços no ar. Na batida piscam, no refrão
 * alternam, na queda abrem-se num tecto de luz sobre as cabeças.
 */
import { CITY, cityShader } from "./_lib";

export default cityShader({
  id: "lasers",
  name: "Lasers de festival",
  names: { en: "Festival lasers" },
  families: ["electronic", "chaos"],
  tags: ["festival", "lasers", "palco", "multidão", "capa"],
  intensity: 5,
  cost: 1,
  signals: ["energy", "bass", "beat", "bar", "drop", "section", "cover", "palette"],
  lyrics: "neon",
}, CITY + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float asp = R.x/R.y;
  float haze = .35 + .65*fbm(p*2.5 + vec2(T*.05, -T*.08));
  vec3 c = vec3(.006,.004,.014) + C1*.03*haze;
  float peak = step(2.5, SECK), calm = step(SECK, .5);
  // os leques
  for(int f=0; f<3; f++){
    float ff = float(f);
    vec2 o = vec2((ff - 1.)*.42*asp, -.3);
    float base = PI*.5 + (ff - 1.)*.25 + .5*sin(BAR*PI*.5 + ff*2.1)*(1. - calm*.6);
    float spread = .25 + .9*BASS + 1.6*DROP + .4*peak;
    vec3 col = nc(ff*.33 + floor(BAR/4.)*.17);
    vec2 r = p - o;
    float ang = atan(r.y, r.x), len = length(r);
    for(int j=0; j<9; j++){
      float fj = float(j)/8. - .5;
      float a = base + fj*spread;
      vec2 dir = vec2(cos(a), sin(a));
      float t = dot(r, dir);
      if(t < 0.) continue;
      float d = abs(r.x*dir.y - r.y*dir.x);
      float chase = mix(1., step(.5, fract((float(j) + BEATN)*.5)), peak*(1. - DROP));
      float w = .0015 + .0035*t;
      float I = (glow(d, w)*1.2 + glow(d, w*5.)*.15)*exp(-t*.7)*chase;
      c += col*I*haze*(.5 + 1.1*kick() + .6*E)*(1. - .7*calm);
    }
    c += col*glow(len, .02)*(1. + kick());
  }
  // na queda: um tecto de laser por cima das cabeças
  float sheet = clamp(DROP*1.3 + peak*.25*smoothstep(4., 0., SECAGE), 0., 1.);
  if(p.y > -.05){
    float z = .25/(p.y + .1);
    float s = sin(z*14. - T*6. + fbm(vec2(p.x*z*2., z))*6.);
    c += nc(.5)*smoothstep(.6, 1., s)*exp(-z*.3)*sheet*1.2*haze;
  }
  // ecrã do palco com a capa (píxeis de LED)
  vec2 sq = p - vec2(0., -.18);
  float sd = sdBox(sq, vec2(.16*1.25, .11*1.25));
  if(sd < 0.){
    vec2 cu = sq/vec2(.4, .275) + .5;
    vec2 led = fract(gl_FragCoord.xy/3.);
    vec3 art = cov((floor(cu*90.) + .5)/90.);
    c = art*(.6 + .4*step(.3, led.x)*step(.3, led.y))*(1. + .6*kick() + DROP);
  }
  c += nc(.2)*glow(max(sd,0.), .03)*.4*(1. + kick());
  // o palco e a multidão
  float stage = step(p.y, -.3);
  c = mix(c, vec3(.01,.008,.015), stage);
  float x = p.x*26.;
  float cell = floor(x), fx = fract(x) - .5;
  float bob = .012*kick()*hash(vec2(cell, 3.)) + .006*sin(T*3. + cell);
  float hy = -.4 + .03*hash(vec2(cell,1.)) + bob;
  float head = length(vec2(fx/26., p.y - hy)) - .014;
  float body = p.y - (hy - .02);
  float arm = step(.6 - .3*E - .3*DROP, hash(vec2(cell, 7. + floor(BEATN/4.))));
  float ad = sdSeg(vec2(fx/26., p.y), vec2(.004, hy), vec2(.012 + .01*sin(T*4. + cell), hy + .07 + .03*kick()));
  float sil = min(min(head, body), mix(1., ad - .003, arm));
  float x2 = p.x*15. + .5, c2 = floor(x2), f2 = fract(x2) - .5;
  float hy2 = -.47 + .03*hash(vec2(c2, 5.)) + .015*kick()*hash(vec2(c2, 6.));
  float sil2 = min(length(vec2(f2/15., p.y - hy2)) - .025, p.y - (hy2 - .03));
  c *= smoothstep(0., .003, sil)*smoothstep(0., .003, sil2);
  c += vec3(1.)*.08*ON*step(2.5, SECK);
  c = aces(c*1.3);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`);
