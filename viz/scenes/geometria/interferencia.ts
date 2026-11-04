/**
 * Interferência: gotas a cair num espelho de água por cima da capa. Cada
 * batida larga uma gota (as fortes maiores), as ondas cruzam-se e a capa
 * refrange-se nelas; nas cristas acende-se a luz das cores da música.
 */
import { HEAD, geoScene } from "./_lib";

const N = 10;
const S = new Float32Array(N * 4);
let next = 0;

export default geoScene<"S">({
  id: "interferencia",
  name: "Interferência",
  names: { en: "Interference", lv: "Interference" },
  families: ["calm", "electronic"],
  tags: ["água", "ondas", "capa", "física"],
  intensity: 2,
  cost: 1,
  signals: ["energy", "bass", "high", "beat", "drop", "cover", "palette"],
  lyrics: "ink",
  artwork: "own",
}, HEAD + `
uniform vec4 S[${N}];
void main(){
  vec2 u = pixuv(uv);
  vec2 p = (u-.5)*vec2(R.x/R.y,1.);
  float h = 0.; vec2 gr = vec2(0.);
  for(int i=0;i<${N};i++){
    vec4 s = S[i];
    float age = T - s.z;
    if(age < 0. || age > 9.) continue;
    vec2 d = p - s.xy;
    float r = length(d) + 1e-4;
    float front = age*.32;
    float env = exp(-max(0., r - front)*24.) * exp(-age*.45) * smoothstep(0., .03, front - r + .15) * s.w;
    float k = 70.;
    float ph = r*k - age*12.;
    h += sin(ph)*env/(1. + r*3.);
    gr += cos(ph)*k*env/(1. + r*3.) * d/r;
  }
  // ondulação de fundo, sempre a mexer um pouco
  h += .06*sin(p.x*18. + T*1.3)*sin(p.y*14. - T) * (.4 + M);
  vec3 n = normalize(vec3(-gr*.012, 1.));
  vec2 ru = u + n.xy*.06;
  vec3 cov = texture(COVER, vec2(ru.x, 1. - ru.y)).rgb;
  vec3 deep = mix(C1*.3, cov, .75);
  float crest = smoothstep(.2, 1., h);
  float spec = pow(max(0., dot(reflect(vec3(0,0,-1), n), normalize(vec3(.3,.5,.8)))), 40.);
  vec3 col = deep * (.55 + .35*E);
  col += vivid(mix(C2, C3, .5+.5*sin(T*.3))) * crest * (.4 + .8*BEAT + DROP);
  col += vec3(1.)*spec*(.6 + H);
  col += vivid(C2)*abs(h)*.25;
  col *= 1. - .35*dot(p,p) - .2*LY*smoothstep(.45,0.,abs(p.y+.05));
  o = vec4(post(aces(col*1.2), gl_FragCoord.xy), 1.);
}`, {
  extra: {
    names: ["S"],
    song() { S.fill(0); for (let i = 0; i < N; i++) S[i * 4 + 2] = -100; next = 0; },
    update(gl, u, t, s, st) {
      const drop = (x: number, y: number, amp: number) => {
        const i = next++ % N;
        S[i * 4] = x; S[i * 4 + 1] = y; S[i * 4 + 2] = t; S[i * 4 + 3] = amp;
      };
      if (st.beatHit) drop((Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 0.8, 0.4 + 0.8 * s.bass);
      if (st.sectionBig) for (let k = 0; k < 3; k++) drop((k - 1) * 0.5, 0, 1.4);
      // sem gotas nenhumas (reduzir movimento, ou ainda sem batidas): três paradas, para haver padrão
      if (S[2] === -100) { drop(-0.35, 0.1, 1); S[2] = t - 2.5; drop(0.3, -0.15, 1); S[6] = t - 1.8; drop(0.05, 0.25, 0.8); S[10] = t - 3.1; }
      gl.uniform4fv(u.S, S);
    },
  },
});
