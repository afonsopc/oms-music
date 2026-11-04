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
