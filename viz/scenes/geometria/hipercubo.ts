/**
 * Hipercubo: um tesseract a rodar em quatro dimensões, projectado duas vezes
 * (4D -> 3D -> ecrã). Em cada compasso dá um quarto de volta brusco num plano
 * que mete a quarta dimensão, e o cubo de dentro passa para fora. Os graves
 * engrossam as arestas, a queda abre-o em perspectiva.
 */
import { HEAD, geoScene } from "./_lib";

const V = new Float32Array(16 * 3);
const v4 = new Float32Array(4);
let snapFrom = 0, snapTo = 0, snapT = 1, plane = 0, spin = 0;

const rot4 = (a: number, i: number, j: number) => {
  const c = Math.cos(a), s = Math.sin(a), x = v4[i], y = v4[j];
  v4[i] = c * x - s * y;
  v4[j] = s * x + c * y;
};

export default geoScene<"V" | "SNAP">({
  id: "hipercubo",
  name: "Hipercubo",
  names: { en: "Hypercube", lv: "Hiperkubs" },
  families: ["electronic"],
  tags: ["4d", "geométrico", "néon", "arame"],
  intensity: 4,
  cost: 1,
  signals: ["energy", "bass", "beat", "bar", "drop", "section", "palette"],
  lyrics: "extrude",
}, HEAD + `
uniform vec3 V[16];
uniform float SNAP;
float seg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
void main(){
  vec2 p = (pixuv(uv)-.5)*vec2(R.x/R.y,1.);
  vec3 col = vec3(0.);
  float w = .003 + .004*B + .003*KICK;
  for(int i=0;i<16;i++){
    vec3 a = V[i];
    for(int b=0;b<4;b++){
      int j = i ^ (1<<b);
      if(j < i) continue;
      vec3 c = V[j];
      float d = seg(p, a.xy, c.xy);
      float depth = .5*(a.z + c.z);
      // aresta da quarta dimensão (a que liga os dois cubos) com outra cor
      vec3 tint = b == 3 ? vivid(C3) : mix(vivid(C1), vivid(C2), depth);
      float k = .35 + .9*depth;
      col += tint * (smoothstep(w*k*1.5, 0., d)*1.2 + .0016/(d + .002)*k*(.35 + .9*BEAT + DROP));
    }
    float dv = length(p - a.xy);
    col += vec3(1.)*exp(-dv*(160. - 80.*KICK))*(.4 + 1.2*a.z);
  }
  // fundo: um brilho na cor da capa e uma grelha ténue a passar
  vec2 g = abs(fract(p*8. + vec2(0., TF*.2)) - .5);
  col += C1*.05 + vivid(C2)*.03*smoothstep(.48,.5,max(g.x,g.y))*(1. - length(p));
  col *= .75 + .45*E + .3*PK + .4*SNAP;
  col *= 1. - .3*LY*smoothstep(.45,0.,abs(p.y+.05));
  o = vec4(post(aces(col), gl_FragCoord.xy), 1.);
}`, {
  extra: {
    names: ["V", "SNAP"],
    song() { snapFrom = snapTo = 0; snapT = 1; plane = 0; },
    update(gl, u, t, s, st) {
      // quarto de volta no compasso, num plano com a quarta dimensão
      if (st.barHit) { snapFrom = snapTo; snapTo += Math.PI / 2; snapT = 0; }
      if (st.sectionHit) plane = (plane + 1) % 3;
      snapT = Math.min(1, snapT + st.dt / 0.45);
      const e = snapT < 1 ? 1 - (1 - snapT) ** 4 : 1;
      const snap = snapFrom + (snapTo - snapFrom) * e;
      spin = st.tf;
      const persp = 2.4 - 0.9 * s.drop - 0.3 * st.pk;
      const scale = 0.5 + 0.05 * st.kick;
      for (let i = 0; i < 16; i++) {
        v4[0] = i & 1 ? 1 : -1; v4[1] = i & 2 ? 1 : -1; v4[2] = i & 4 ? 1 : -1; v4[3] = i & 8 ? 1 : -1;
        rot4(snap, plane, 3);
        rot4(spin * 0.23, 0, 3);
        rot4(spin * 0.17, 1, 2);
        rot4(spin * 0.11 + 0.6, 0, 2);
        rot4(0.5, 1, 3);
        const k4 = 1 / (persp - v4[3] * 0.55);
        const x = v4[0] * k4, y = v4[1] * k4, z = v4[2] * k4;
        const k3 = 1 / (2.6 - z);
        V[i * 3] = x * k3 * scale * 2.6;
        V[i * 3 + 1] = y * k3 * scale * 2.6;
        V[i * 3 + 2] = Math.min(1, Math.max(0, 0.5 + 0.6 * z));
      }
      gl.uniform3fv(u.V, V);
      gl.uniform1f(u.SNAP, snapT < 1 ? 1 - snapT : 0);
      void t;
    },
  },
});
