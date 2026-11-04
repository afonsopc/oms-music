/** Campo de estrelas em velocidade de dobra; os graves carregam no acelerador. */
import { canvasScene } from "../../lib/canvas";
import { rand } from "../../lib/random";

export default canvasScene({
  id: "starfield",
  name: "Estrelas",
  names: { en: "Stars", lv: "Zvaigznes" },
  families: ["retro"],
  tags: ["protector-de-ecrã", "espaço", "velocidade"],
  intensity: 3,
  cost: 1,
  signals: ["energy", "bass", "beat", "palette"],
  lyrics: "extrude",
}, () => {
  let stars: { x: number; y: number; z: number; pz: number }[] = [];
  return {
    reset: () => { stars = []; },
    frame(ctx, w, h, dt, _t, s, env) {
      const n = env.lowPower ? 350 : 900;
      while (stars.length < n) stars.push({ x: rand(-1, 1), y: rand(-1, 1), z: rand(0.05, 1), pz: 1 });
      ctx.fillStyle = `rgba(0,0,0,${0.35 + 0.4 * (1 - s.energy)})`;
      ctx.fillRect(0, 0, w, h);
      const speed = (0.15 + 1.6 * s.bass + 2.5 * s.beat) * dt;
      const cx = w / 2, cy = h / 2, f = Math.min(w, h) * 0.5;
      ctx.lineCap = "round";
      for (const st of stars) {
        st.pz = st.z;
        st.z -= speed;
        if (st.z <= 0.02) { st.x = rand(-1, 1); st.y = rand(-1, 1); st.z = 1; st.pz = 1; continue; }
        const x = cx + (st.x / st.z) * f, y = cy + (st.y / st.z) * f;
        const px = cx + (st.x / st.pz) * f, py = cy + (st.y / st.pz) * f;
        ctx.strokeStyle = st.z < 0.3 ? "#fff" : env.colors[(st.x > 0 ? 1 : 2)];
        ctx.lineWidth = (1 - st.z) * 3;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    },
  };
});
