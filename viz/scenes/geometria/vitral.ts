/**
 * Vitral de Voronoi: a capa partida em células de vidro, com chumbo a brilhar
 * entre elas. As células respiram com os graves, uma acende-se em cada
 * batida, e na queda o vitral estala em pedaços mais pequenos.
 */
import { HEAD, geoScene } from "./_lib";

export default geoScene({
  id: "vitral",
  name: "Vitral de Voronoi",
  names: { en: "Voronoi glass", lv: "Voronoja vitrāža" },
  families: ["calm", "electronic"],
  tags: ["capa", "vidro", "células", "geométrico"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "high", "beat", "drop", "section", "cover", "palette"],
  lyrics: "ink",
  artwork: "own",
}, HEAD + `
// devolve (distância à aresta, id da célula) e o centro da célula
vec3 vor(vec2 x, out vec2 center){
  vec2 n = floor(x), f = fract(x);
  vec2 mg, mr; float md = 8.;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 g = vec2(i,j);
    vec2 h = hash2(n+g);
    vec2 r = g + .5 + .42*sin(TF*.35 + TAU*h) - f;
    float d = dot(r,r);
    if(d < md){ md = d; mr = r; mg = g; }
  }
  float ed = 8.;
  for(int j=-2;j<=2;j++) for(int i=-2;i<=2;i++){
    vec2 g = mg + vec2(i,j);
    vec2 h = hash2(n+g);
    vec2 r = g + .5 + .42*sin(TF*.35 + TAU*h) - f;
    if(dot(mr-r,mr-r) > 1e-5) ed = min(ed, dot(.5*(mr+r), normalize(r-mr)));
  }
  center = x + mr;
  return vec3(ed, n + mg);
}
void main(){
  vec2 u = pixuv(uv);
  vec2 p = (u-.5)*vec2(R.x/R.y,1.);
  float dens = 4.5 + 2.*floor(mod(SG, 3.)) + 5.*PK;
  vec2 q = p*rot(.05*sin(TF*.1))*dens*(1. - .06*B);
  vec2 cen;
  vec3 v = vor(q, cen);
  float id = hash(v.yz);
  // a capa vista através de cada vidro, a cor tirada do centro da célula
  vec2 cu = cen/dens; cu.x /= R.x/R.y;
  vec3 glass = texture(COVER, vec2(1.,-1.)*cu*.92 + .5).rgb;
  vec3 tint = pal(id + TF*.02);
  glass = mix(glass, glass*tint*1.6, .35);
  float fire = step(hash(v.yz + BN*.137), .08 + .12*PK) * (.5+.5*BEAT) + step(.985, hash(v.yz + floor(T*8.)))*H;
  float fres = smoothstep(.0, .5, v.x);
  glass *= .45 + .35*fres + .5*E + 1.4*fire;
  // chumbo: a aresta, com brilho de néon por dentro
  float w = .03 + .04*KICK;
  float lead = smoothstep(w, 0., v.x);
  vec3 neon = vivid(mix(C2, C3, id));
  vec3 col = mix(glass, vec3(.01), lead);
  col += neon * exp(-v.x*(22. - 10.*B)) * (.35 + .9*BEAT + 1.2*DROP);
  col += vec3(1.)*pow(1.-fres, 8.)*.15;
  col *= 1. - .3*dot(p,p) - .25*LY*smoothstep(.45,0.,abs(p.y+.05));
  o = vec4(post(aces(col*1.1), gl_FragCoord.xy), 1.);
}`);
