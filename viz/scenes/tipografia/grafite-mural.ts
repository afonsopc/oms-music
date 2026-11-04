/**
 * Grafite: o título pintado a spray num muro de betão, a crescer da
 * esquerda para a direita: primeiro o contorno, depois o enchimento em
 * degradê com o brilho, por fim a sombra 3D; a tinta a mais escorre em
 * pingos. Cada secção pinta-o de novo por cima; os graves fazem escorrer
 * mais, a batida acende a luz do candeeiro, e na queda a luz negra faz a
 * tinta brilhar.
 */
import { TEXT_HEAD, WIDE, artistOf, fit, hash1, textShader, titleOf, units, wrapLines } from "./_lib";

export default textShader({
  id: "grafite-mural",
  name: "Grafite",
  names: { en: "Graffiti", lv: "Grafiti" },
  families: ["chaos", "retro"],
  tags: ["rua", "spray", "tinta", "título", "cidade", "hip-hop"],
  intensity: 4,
  cost: 1,
  signals: ["bass", "beat", "onset", "drop", "section", "title", "palette"],
  lyrics: "glitch",
}, TEXT_HEAD + `
void main(){
  vec2 u = pixuv(uv);
  vec2 tu = vec2(u.x, 1.-u.y);
  vec2 px = 1./TR;
  float prog = U0.x;
  float front = prog*1.3 - .15;
  float edge = noise(u*vec2(4.,30.))*.08;
  float revO = smoothstep(front+.01, front-.01, u.x + edge);
  float revF = smoothstep(front-.06, front-.1, u.x + edge);
  float revS = smoothstep(front-.14, front-.18, u.x + edge);
  vec4 tx = texture(TXT, tu);
  // pingos: uma coluna em cada tanto pinga, tanto mais quanto mais tempo passou
  float colx = floor(gl_FragCoord.x/3.);
  float drippy = step(.86, hash(vec2(colx, U0.w)));
  float L = (.02 + .12*hash(vec2(colx, 9.)))*clamp(U0.y,0.,1.)*(1.+B);
  float drip = 0.;
  for (int i = 1; i <= 4; i++) {
    float d = L*float(i)/4.;
    drip = max(drip, texture(TXT, tu - vec2(0., d)).r*(1.-float(i)*.18));
  }
  drip *= drippy*revF;
  // muro: betão com juntas
  vec2 wp = gl_FragCoord.xy/R.y;
  float conc = fbm(wp*6.)*.5 + fbm(wp*40.)*.3 + hash(gl_FragCoord.xy)*.08;
  vec3 wall = vec3(.42,.41,.4)*(.55+.5*conc);
  wall *= 1. - .6*smoothstep(.006,.0,abs(fract(wp.x*.55+.3)-.5)-.497);
  float lamp = .55 + .35*BEAT + .2*E;
  vec2 lc = (u - vec2(.5,1.1))*vec2(R.x/R.y,1.);
  float pool = exp(-dot(lc,lc)*1.4);
  float uvm = smoothstep(.2,.8,DROP + U0.z);
  vec3 lightc = mix(vec3(1.,.93,.8), vec3(.35,.15,1.), uvm);
  vec3 col = wall*lightc*(.5 + pool*lamp*.9)*(1.-.45*uvm);
  // a peça
  // a pintura da secção anterior fica por baixo, desbotada, até a nova a tapar
  float old = U0.w > 0. ? .45 : 0.;
  float shadow = max(tx.b*revS, tx.b*old);
  float outl = max(tx.g*revO, tx.g*old);
  float fill = max(max(tx.r*revF, drip), tx.r*old);
  vec3 grad = mix(C1, C3, smoothstep(.2,.8, tu.y*1.4 - .2 + .1*sin(u.x*9.)));
  float shine = smoothstep(.02,.0,abs(fract(tu.y*3.5 - u.x*1.2)-.5)-.47)*.6;
  vec3 paint = grad*1.15 + shine;
  vec3 lit = vec3(.35 + pool*lamp*.9);
  vec3 glow = vec3(0.);
  col = mix(col, mix(C2,vec3(0.),.75)*lit, shadow*.95);
  col = mix(col, vec3(.04)*lit + C2*uvm*.6, outl);
  col = mix(col, paint*mix(lit, vec3(1.6), uvm), fill);
  glow += uvm*(fill*grad + outl*C2)*.5;
  // nuvem de spray à frente
  float mist = smoothstep(.1,.0,abs(u.x + edge - front))*hash(gl_FragCoord.xy + floor(T*30.))*(tx.g+tx.r)*step(prog,.999);
  col += mist*C1*.8;
  col += glow;
  col *= 1. - .35*length(u-.5);
  o = vec4(post(col, gl_FragCoord.xy), 1.);
}`, {
  size: (w, h) => { const a = Math.min(1280, w); return [a, Math.round((a * h) / w)]; },
  dirty: () => false,
  paint(ctx, w, h, env) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const title = titleOf(env);
    const font = (px: number) => `${px}px ${WIDE}`;
    let size = fit(ctx, title, w * 0.8, font, h * 0.36);
    let lines = [title];
    if (size < h * 0.15 && /\s/.test(title)) {
      ctx.font = font(h * 0.18);
      lines = wrapLines(ctx, title, w * 0.8, 3);
      size = h * 0.28;
      for (const l of lines) size = Math.min(size, fit(ctx, l, w * 0.8, font, h * 0.28));
    }
    ctx.lineJoin = "round";
    ctx.textBaseline = "middle";
    // cada letra torta à sua maneira (fica como grafite, não como tipo de letra)
    const glyphs: { c: string; x: number; y: number; r: number; s: number }[] = [];
    let seed = 0;
    for (let li = 0; li < lines.length; li++) {
      ctx.font = font(size);
      const us = units(lines[li]);
      const ws = us.map((c) => ctx.measureText(c).width * 0.92);
      const tw = ws.reduce((a, b) => a + b, 0);
      let x = w / 2 - tw / 2;
      const y = h * 0.46 + (li - (lines.length - 1) / 2) * size * 1.02;
      us.forEach((c, i) => {
        seed++;
        if (c.trim()) glyphs.push({ c, x: x + ws[i] / 2, y: y + (hash1(seed) - 0.5) * size * 0.16 - Math.sin(i * 0.7) * size * 0.06, r: (hash1(seed * 3) - 0.5) * 0.28, s: 0.92 + hash1(seed * 7) * 0.22 });
        x += ws[i];
      });
    }
    const draw = (pass: number) => {
      for (const g of glyphs) {
        ctx.save();
        ctx.translate(g.x + (pass === 2 ? size * 0.09 : 0), g.y + (pass === 2 ? size * 0.08 : 0));
        ctx.rotate(g.r);
        ctx.scale(g.s, g.s);
        ctx.textAlign = "center";
        ctx.font = font(size);
        if (pass === 0) { ctx.fillStyle = "#f00"; ctx.fillText(g.c, 0, 0); }
        else { ctx.strokeStyle = ctx.fillStyle = pass === 1 ? "#0f0" : "#00f"; ctx.lineWidth = size * 0.14; ctx.strokeText(g.c, 0, 0); ctx.fillText(g.c, 0, 0); }
        ctx.restore();
      }
    };
    ctx.globalCompositeOperation = "lighter";
    draw(2);
    draw(1);
    draw(0);
    // a assinatura: o artista, um tag pequeno
    const art = artistOf(env);
    ctx.font = `${Math.max(12, Math.round(h * 0.05))}px ${WIDE}`;
    ctx.save();
    ctx.translate(w * 0.8, h * 0.85);
    ctx.rotate(-0.12);
    ctx.textAlign = "center";
    ctx.fillStyle = "#0f0";
    ctx.fillText(art, 0, 0, w * 0.3);
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
  },
  set(u, _t, s, env) {
    // pinta em ~6 s a cada secção; os pingos continuam a crescer
    const age = env.reduceMotion ? 99 : Math.max(0, s.sectionAge);
    u[0] = Math.min(1, age / 6);
    u[1] = Math.max(0, (age - 2) / 10);
    u[2] = s.section === "drop" || s.section === "high" ? 0.5 : 0;
    u[3] = Math.max(0, s.sectionIndex);
  },
});
