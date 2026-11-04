/**
 * Capa em ASCII: a capa desenhada só com caracteres de terminal (" .:-=+*#%@"),
 * a respirar e a rodar devagar; por cima, a linha da letra em letras
 * gigantes feitas de células, cada célula uma letra da própria linha. A
 * batida varre uma faixa de luz, os ataques trocam caracteres ao acaso, os
 * graves aproximam a capa, a queda inverte tudo e cada secção muda o
 * tamanho das células.
 */
import { MONO, TEXT_HEAD, WIDE, fit, textShader, units, upper, wrapLines } from "./_lib";

const RAMP = " .:-=+*#%@";
/** Quantas letras da linha estão no atlas (o shader cicla por elas). */
let nChars = 1;

export default textShader({
  id: "capa-ascii",
  name: "Capa em ASCII",
  names: { en: "ASCII cover", lv: "ASCII vāks" },
  families: ["retro", "electronic"],
  tags: ["terminal", "texto", "letra", "capa", "computador"],
  intensity: 3,
  cost: 1,
  signals: ["bass", "beat", "onset", "drop", "section", "lyric", "cover", "palette"],
  lyrics: "own",
  artwork: "own",
}, TEXT_HEAD + `
vec4 glyph(float slot, vec2 f){
  vec2 a = vec2((mod(slot,16.)*64. + f.x*60.+2.)/1024., (floor(slot/16.)*64. + (1.-f.y)*60.+2.)/1024.);
  return texture(TXT, a);
}
void main(){
  float cs = U0.x;
  vec2 fc = gl_FragCoord.xy;
  vec2 cell = floor(fc/cs);
  vec2 f = fract(fc/cs);
  vec2 cc = (cell+.5)*cs/R;
  // a capa: centrada, quadrada, a respirar
  vec2 q = (cc-.5)*vec2(R.x/R.y,1.);
  q *= rot(sin(T*.07)*.25) ;
  q /= 1.05 + .25*B + .1*sin(T*.2);
  vec2 cu = vec2(q.x, -q.y)*.95+.5;
  vec3 cov = texture(COVER, cu).rgb;
  if (cu.x < 0. || cu.x > 1. || cu.y < 0. || cu.y > 1.) cov *= .18;
  float l = dot(cov, vec3(.3,.55,.15));
  l = pow(clamp(l*1.15,0.,1.), .9);
  // a linha da letra (máscara na metade de baixo da textura)
  vec2 mp = vec2(cc.x, (cc.y-.5)*(R.y/R.x)/.75 + .5);
  float m = 0.;
  if (mp.y > 0. && mp.y < 1.) m = texture(TXT, vec2(mp.x, .25 + (1.-mp.y)*.75)).r;
  float scan = exp(-abs(fract(cc.y - BAR*.25) - .5)*30.)*BEAT;
  float glitch = step(.985 - ON*.1, hash(cell + floor(T*12.)));
  vec3 col;
  if (m > .5) {
    float n = max(1., U0.y);
    float slot = 32. + mod(cell.x + cell.y*3., n);
    float g = glyph(slot, f).r;
    vec3 hot = mix(vec3(1.), C2*1.4, .35);
    col = hot*g*(1.2+.8*BEAT) + C1*.12;
  } else {
    float idx = floor(clamp(l + glitch*.5, 0., .999)*10.);
    if (glitch > .5) idx = floor(hash(cell+T)*10.);
    float g = glyph(idx, f).r;
    vec3 tint = mix(cov*1.4, pal(l*.5 + T*.02), .35);
    col = tint*g*(.65 + .5*E) + scan*C3*g;
  }
  col = mix(col, vec3(.9) - col*.8, U0.z);
  col += DROP*.15*C2;
  col *= 1. - .25*length(uv-.5);
  o = vec4(post(col, fc), 1.);
}`, {
  size: () => [1024, 1024],
  paint(ctx, _w, _h, _env, lyr) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 54px ${MONO}`;
    for (let i = 0; i < RAMP.length; i++) ctx.fillText(RAMP[i], i * 64 + 32, 34);
    const chars = units(upper(lyr.text)).filter((u) => u.trim()).slice(0, 32);
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      ctx.font = `700 ${c.length > 1 ? Math.max(14, Math.floor(110 / c.length)) : 54}px ${MONO}`;
      ctx.fillText(c, (i % 16) * 64 + 32, 128 + Math.floor(i / 16) * 64 + 34, 62);
    }
    // a máscara: a linha em letras grandes
    const font = (px: number) => `${px}px ${WIDE}`;
    const t = upper(lyr.text);
    let size = fit(ctx, t, 940, font, 230);
    let lines = [t];
    if (size < 120 && /\s/.test(t)) {
      ctx.font = font(150);
      lines = wrapLines(ctx, t, 940, 3);
      size = 170;
      for (const l of lines) size = Math.min(size, fit(ctx, l, 940, font, 170));
    }
    ctx.font = font(size);
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], 512, 640 + (i - (lines.length - 1) / 2) * size * 1.1);
    nChars = chars.length;
  },
  set(u, _t, s, _env, _l, _dt, _w, h) {
    const big = s.section === "drop" || s.section === "high";
    const calm = s.section === "intro" || s.section === "outro" || s.section === "breakdown";
    u[0] = Math.round((big ? 9 : calm ? 16 : 12) * Math.max(1, h / 720));
    u[1] = nChars;
    u[2] = s.drop > 0.6 ? 1 : 0;
  },
});
