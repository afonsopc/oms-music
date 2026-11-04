/**
 * As cenas de shader. Todas recebem os mesmos uniformes: tempo, resolução,
 * o sinal da música (energia, graves, médios, agudos, batida, compasso,
 * ataque), as três cores da capa, a capa como textura e, na `milk`, o frame
 * anterior (retorno).
 */

const HEAD = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform vec2 R; uniform float T, E, B, LM, M, H, BEAT, BAR, ON, PIX, DITHER;
uniform vec3 C1, C2, C3; uniform sampler2D COVER; uniform sampler2D PREV;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=.5;} return v; }
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
vec3 pal(float t){ t=fract(t); return t<.33? mix(C1,C2,t*3.) : t<.66? mix(C2,C3,(t-.33)*3.) : mix(C3,C1,(t-.66)*3.); }
vec2 pixuv(vec2 u){ if(PIX<1.) return u; vec2 g=R/PIX; return (floor(u*g)+.5)/g; }
vec3 post(vec3 c, vec2 fc){
  if(DITHER>.5){ float b=hash(floor(fc/2.)); c=floor(c*4.+b)/4.; }
  return c;
}
`;

/** Fundo do leitor: aurora em domínio deformado, a respirar com a música. */
export const AURORA = HEAD + `
void main(){
  vec2 p = (uv-.5)*vec2(R.x/R.y,1.);
  float t = T*.06;
  vec2 q = vec2(fbm(p*1.3+t), fbm(p*1.3-t+4.2));
  vec2 w = p + (.55+.5*B)*q + .08*vec2(sin(T*.3), cos(T*.27));
  float n = fbm(w*1.6 + vec2(t*2., -t));
  float k = smoothstep(.15,.95,n);
  vec3 c = mix(C1*.55, C2, k);
  c = mix(c, C3, smoothstep(.55,1.,fbm(w*2.3-t*3.))*.7);
  c *= .72 + .45*E + .25*BEAT;
  float v = 1.-.55*dot(p*.9,p*.9);
  o = vec4(post(c*v, gl_FragCoord.xy), 1.);
}`;

/** A cena MilkDrop: o frame anterior deformado (zoom, rotação, ondas) e formas novas por cima. */
export const MILK = HEAD + `
void main(){
  vec2 p = uv-.5; p.x *= R.x/R.y;
  float zoom = .985 - .02*B - .012*BEAT;
  float ang = .004 + .02*sin(T*.21) + .03*ON*sign(sin(BAR*3.14));
  vec2 q = rot(ang)*p*zoom;
  q += .006*vec2(sin(q.y*9.+T), cos(q.x*7.-T*1.3))*(1.+2.*M);
  q.x /= R.x/R.y;
  vec3 prev = texture(PREV, q+.5).rgb;
  prev *= .965 - .02*H;
  // um anel de onda a nascer no centro, a cor da capa a rodar
  float r = length(p);
  float ring = smoothstep(.012,.0, abs(r - (.12+.25*E + .03*sin(atan(p.y,p.x)*6.+T*2.)*(.5+M))));
  vec3 add = pal(T*.05 + r) * ring * (.6+1.4*BEAT);
  // faíscas nos ataques
  float sp = step(.997 - .01*ON, hash(floor(uv*R/3.) + floor(T*30.)));
  add += sp * C3 * ON * 2.;
  o = vec4(post(clamp(prev + add, 0., 1.), gl_FragCoord.xy), 1.);
}`;

/** Caleidoscópio sobre a capa: seis fatias, a rodar no compasso. */
export const KALEIDO = HEAD + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float r = length(p), a = atan(p.y,p.x);
  float seg = 6. + 2.*floor(mod(BAR,4.));
  a = mod(a, 6.2831/seg); a = abs(a - 3.1416/seg);
  vec2 k = vec2(cos(a), sin(a))*r;
  k = rot(T*.1 + BAR*.25)*k * (1.2 - .3*B);
  vec3 c = texture(COVER, k*.9 + .5 + .05*vec2(sin(T*.3), cos(T*.2))).rgb;
  c = mix(c, pal(r - T*.1), .25 + .3*H);
  c *= .7 + .6*E + .4*BEAT;
  o = vec4(post(c*(1.-.4*r), gl_FragCoord.xy), 1.);
}`;

/** Túnel: a capa a forrar um túnel que acelera com os graves. */
export const TUNNEL = HEAD + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  p *= rot(.2*sin(T*.4) + BEAT*.15);
  float r = length(p) + 1e-3, a = atan(p.y,p.x);
  float speed = T*(.35 + .6*E) + BAR*.25;
  vec2 t = vec2(a/3.1416, .35/r + speed);
  vec3 c = texture(COVER, t).rgb;
  float rings = .5+.5*sin(.35/r*6. - speed*12.);
  c = mix(c, pal(t.y*.2), .2) * (.55 + .5*rings*B);
  c *= smoothstep(0., .35, r) * (1. + .6*BEAT);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;

/** Plasma à antiga, nas cores da capa. */
export const PLASMA = HEAD + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.)*3.;
  float t = T*.6;
  float v = sin(p.x*1.7+t) + sin(p.y*2.1-t*1.3) + sin((p.x+p.y)*1.3+t*.7) + sin(length(p*(1.+B))*3.-t*2.);
  vec3 c = pal(v*.12 + T*.03 + BAR*.05);
  c *= .65 + .5*E + .35*BEAT;
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;

/** Cromado de render antigo: um cubo/toro com a capa, luz "por omissão" e reflexo do céu. */
export const CHROME = HEAD + `
float sdBox(vec3 p, vec3 b){ vec3 q=abs(p)-b; return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.); }
float sdTorus(vec3 p, vec2 t){ vec2 q=vec2(length(p.xz)-t.x,p.y); return length(q)-t.y; }
float shapeSel(){ return mod(floor(BAR/4.), 3.); }
float map(vec3 p){
  float s = 1. + .18*BEAT + .1*B;
  p.xz *= rot(T*.6 + BAR*.5); p.xy *= rot(T*.37);
  float k = shapeSel();
  float d = k < .5 ? sdBox(p, vec3(.75*s)) - .04 : k < 1.5 ? sdTorus(p, vec2(.8*s, .3*s)) : length(p) - .95*s;
  return d;
}
vec3 nrm(vec3 p){ vec2 e=vec2(.002,0); return normalize(vec3(map(p+e.xyy)-map(p-e.xyy), map(p+e.yxy)-map(p-e.yxy), map(p+e.yyx)-map(p-e.yyx))); }
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  vec3 ro = vec3(0,0,3.2), rd = normalize(vec3(p, -1.6));
  float t = 0.; bool hit = false;
  for(int i=0;i<80;i++){ float d = map(ro+rd*t); if(d<.001){ hit=true; break; } t += d; if(t>8.) break; }
  // fundo: grelha de chão a fugir, ao estilo das demos antigas
  vec3 bg = mix(C1*.15, C2*.35, uv.y);
  vec2 g = vec2(p.x/(.6-p.y+.001), 1./(.6-p.y+.001) + T*(1.+2.*E));
  float grid = (p.y < .1) ? smoothstep(.06,.0, min(abs(fract(g.x)-.5), abs(fract(g.y)-.5))) : 0.;
  bg += grid * C3 * (.4 + 1.2*BEAT) * smoothstep(.1,-.4,p.y);
  vec3 c = bg;
  if(hit){
    vec3 pos = ro+rd*t, n = nrm(pos);
    vec3 q = pos; q.xz *= rot(T*.6 + BAR*.5); q.xy *= rot(T*.37);
    vec3 an = abs(n);
    vec2 tuv = an.x>an.y&&an.x>an.z ? q.yz : an.y>an.z ? q.xz : q.xy;
    vec3 tex = texture(COVER, tuv*.6+.5).rgb;
    vec3 l = normalize(vec3(.6,.8,.5));
    float dif = max(dot(n,l),0.), spec = pow(max(dot(reflect(-l,n),-rd),0.), 48.);
    vec3 env = mix(C2, vec3(1), .5+.5*reflect(rd,n).y);
    c = tex*(.25+.9*dif) + .55*env*pow(1.-max(dot(n,-rd),0.),2.) + spec*(1.+BEAT);
  }
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;

/** Synthwave: o sol às riscas e a grelha néon a correr para nós, nos graves. */
export const SYNTHWAVE = HEAD + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  vec3 sky = mix(vec3(.05,.0,.12), mix(C2,vec3(1.,.3,.6),.5)*.55, smoothstep(-.1,.5,p.y));
  vec3 c = sky;
  // sol
  vec2 sp = p - vec2(0.,.12);
  float r = length(sp), sun = smoothstep(.3+.03*BEAT,.29+.03*BEAT, r);
  float stripes = step(.5, fract((sp.y+T*.03)*18.)) + step(.05, sp.y);
  c = mix(c, mix(vec3(1.,.85,.3), vec3(1.,.2,.55), clamp(.5-sp.y*2.,0.,1.)), sun*clamp(stripes,0.,1.));
  c += vec3(1.,.3,.6)*.4*exp(-r*4.)*(.6+E);
  // montanhas
  float m = .02 + .07*abs(sin(p.x*3.+1.)) + .04*abs(sin(p.x*7.3));
  if(p.y < m - .02) c = mix(vec3(.08,.0,.15), C1*.4, .3);
  // grelha
  if(p.y < -.02){
    float z = .35/(-p.y+.001);
    vec2 g = vec2(p.x*z, z + T*(1.5+4.*B));
    // perto de um inteiro = em cima de uma linha da grelha
    float wx = fwidth(g.x)*1.5 + .02, wy = fwidth(g.y)*1.5 + .02;
    float line = max(smoothstep(.5-wx,.5,abs(fract(g.x)-.5)), smoothstep(.5-wy,.5,abs(fract(g.y)-.5)));
    vec3 neon = mix(vec3(1.,.2,.8), C3+vec3(.2), .4);
    c = mix(vec3(.02,0.,.05), neon*(1.2+1.5*BEAT), line*exp(-z*.08));
  }
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;

/** Metal líquido: bolhas de mercúrio que se juntam e se separam ao ritmo. */
export const LIQUID = HEAD + `
float field(vec2 p){
  float v = 0.;
  for(int i=0;i<6;i++){
    float fi = float(i);
    vec2 c = .38*vec2(sin(T*(.31+.07*fi)+fi*2.1), cos(T*(.27+.05*fi)+fi*1.3)) * (1.+.5*B);
    v += (.035 + .02*BEAT + .015*(fi==0.?E:M)) / dot(p-c,p-c);
  }
  return v;
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float f = field(p);
  vec2 e = vec2(.002,0.);
  vec3 n = normalize(vec3(field(p+e.xy)-field(p-e.xy), field(p+e.yx)-field(p-e.yx), .06));
  float inside = smoothstep(.9,1.1,f);
  vec3 env = mix(C1*.3, vec3(1.), .5+.5*n.y) ; env = mix(env, C3, .3*(.5+.5*n.x));
  float spec = pow(max(dot(n, normalize(vec3(.4,.6,1.))),0.), 30.);
  vec3 c = mix(vec3(.02), env*.9 + spec*(1.2+BEAT), inside);
  c += C2*.15*smoothstep(.5,.9,f)*(1.-inside);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;

/** Cidade de voxels: um voo rasante sobre prédios que crescem com a música. */
export const VOXEL = HEAD + `
float city(vec3 p){
  vec2 id = floor(p.xz); vec2 f = fract(p.xz)-.5;
  float h = hash(id)*1.4 + .2 + 1.2*B*hash(id+3.) + .8*BEAT*step(.8,hash(id+7.));
  float box = max(max(abs(f.x),abs(f.y))-.38, p.y-h);
  return max(box, -p.y);
}
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  vec3 ro = vec3(sin(T*.2)*2., 2.4, T*(2.+3.*E));
  vec3 rd = normalize(vec3(p.x, p.y-.35, 1.));
  rd.xy *= rot(.08*sin(T*.3));
  float t = 0.; bool hit = false;
  for(int i=0;i<90;i++){ float d = city(ro+rd*t); if(d<.002){hit=true;break;} t += max(d*.6,.01); if(t>40.) break; }
  vec3 c = mix(vec3(.02,.01,.06), C1*.3, smoothstep(-.2,.6,rd.y));
  if(hit){
    vec3 q = ro+rd*t; vec2 id = floor(q.xz);
    float win = step(.82, hash(floor(q.xz*5.)+floor(q.y*5.))) * step(.05, q.y);
    vec3 lit = mix(C2, C3, hash(id));
    float shade = .1 + .12*hash(id+1.);
    c = vec3(shade)*mix(vec3(1.), C1, .4) + lit*win*(.55+1.2*BEAT);
    c = mix(c, vec3(.05,.02,.1), 1.-exp(-t*.05));
  }
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;

/** Galáxia de partículas: uma espiral de estrelas que gira mais depressa nos graves. */
export const GALAXY = HEAD + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  p *= rot(.3) ; p.y *= 1.6;
  float r = length(p), a = atan(p.y,p.x);
  vec3 c = vec3(0.);
  float spin = T*(.15+.4*B) + BAR*.1;
  for(int k=0;k<3;k++){
    float fk = float(k);
    float arm = sin(a*2. - log(r+.001)*5. + spin + fk*2.09);
    float dens = smoothstep(.4,1.,arm) * exp(-r*2.2);
    vec2 g = vec2(a*40.+fk*13., r*120.);
    float star = step(.985 - .02*E, hash(floor(g))) * dens * 6.;
    c += mix(C2, C3, fk*.5) * dens * .5 + vec3(star);
  }
  c += mix(vec3(1.,.9,.7), C2, .3) * exp(-r*9.)*(1.+2.*BEAT);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;

/** VHS: a capa numa cassete gasta: tracking, ruído, cores a escorregar. */
export const VHS = HEAD + `
void main(){
  vec2 u = pixuv(uv);
  float band = step(.97 - .05*BEAT, hash(vec2(floor(u.y*40.), floor(T*12.))));
  u.x += band*.04*sin(T*40.) + .003*sin(u.y*300.+T*20.)*(.5+H);
  float roll = fract(T*.05 + BAR*.02);
  u.y = fract(u.y + .02*smoothstep(.0,.02, abs(u.y-roll)-.0)*0.);
  vec2 cu = (u-.5)*vec2(R.x/R.y,1.)*.9+.5;
  float sh = .006 + .02*ON;
  vec3 c = vec3(texture(COVER, cu+vec2(sh,0.)).r, texture(COVER, cu).g, texture(COVER, cu-vec2(sh,0.)).b);
  c = mix(c, vec3(dot(c,vec3(.3,.59,.11))), .25);
  c += (hash(u*R + T*60.)-.5)*.18;
  c *= .85 + .15*sin(u.y*R.y*1.5);
  c += vec3(1.)*smoothstep(.01,.0,abs(u.y-roll))*.25;
  c *= .7 + .5*E;
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;

/** Datamosh: o frame anterior escorrega aos blocos, a capa infiltra-se nos ataques. */
export const DATAMOSH = HEAD + `
void main(){
  vec2 u = uv;
  vec2 blk = floor(u*vec2(24.,14.));
  vec2 mv = (vec2(hash(blk+floor(T*4.)), hash(blk+7.+floor(T*4.)))-.5) * (.01 + .05*B);
  vec3 prev = texture(PREV, u - mv).rgb;
  vec2 cu = (u-.5)*vec2(R.x/R.y,1.)*.95+.5;
  vec3 cov = texture(COVER, cu + mv*2.).rgb;
  float inject = step(.92 - .4*ON - .3*BEAT, hash(blk + floor(T*10.)));
  vec3 c = mix(prev*.995, cov, max(inject, .02));
  if(hash(vec2(floor(T*8.), 3.)) > .9) c = c.gbr;
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;

/** Tinta: manchas de tinta a abrir num papel, calmas, para o fado e o acústico. */
export const INK = HEAD + `
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  float t = T*.04;
  vec2 q = p*1.4;
  q += .3*vec2(fbm(q+t), fbm(q-t+5.));
  float n = fbm(q*2. + vec2(t*3., -t));
  float ink = smoothstep(.55 - .15*E, .62 - .15*E, n);
  float edge = smoothstep(.0,.04, abs(n - (.58 - .15*E))) ;
  vec3 paper = vec3(.93,.9,.84) - .06*fbm(p*30.);
  vec3 tint = mix(vec3(.08,.08,.12), C1*.5, .35);
  vec3 c = mix(paper, tint, ink);
  c = mix(c*.85, c, edge);
  c *= 1. - .25*dot(p,p);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;

/** Película: a capa em grão de filme, devagar, com a luz a respirar. */
export const FILM = HEAD + `
void main(){
  vec2 u = pixuv(uv);
  vec2 cu = (u-.5)*vec2(R.x/R.y,1.);
  cu *= 1.05 - .05*sin(T*.1);
  cu *= rot(.02*sin(T*.07));
  vec3 c = texture(COVER, cu*.8+.5).rgb;
  float l = dot(c, vec3(.3,.59,.11));
  c = mix(vec3(l), c, .55) * vec3(1.05,1.,.92);
  c += (hash(u*R*.5 + floor(T*24.))-.5)*.12;
  float scratch = step(.996, hash(vec2(floor(u.x*R.x/2.), floor(T*24.))));
  c += scratch*.25;
  c *= .75 + .35*E;
  c *= smoothstep(.95,.3, length(u-.5)*1.25);
  o = vec4(post(c, gl_FragCoord.xy), 1.);
}`;
