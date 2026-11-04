/**
 * Tira o esqueleto estático (#boot, app/+html.tsx) com um fade curto, quando
 * o primeiro ecrã da app já montou por baixo.
 */
export const hideBootSplash = (): void => {
  if (typeof document === "undefined") return;
  const boot = document.getElementById("boot");
  if (!boot || boot.classList.contains("out")) return;
  // Dois frames: o ecrã por baixo pinta antes de o esqueleto sair.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      boot.classList.add("out");
      setTimeout(() => boot.remove(), 260);
    }),
  );
};
