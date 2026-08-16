/** Puro (bun-testável): o salto do preview de artista. ~1/3 da faixa com
 *  tecto de 45 s - os refrões vivem lá, os intros não; faixas curtas ou sem
 *  duração conhecida começam do zero. */
export const previewSeekSeconds = (duration: number | null | undefined): number => {
  if (!duration || duration <= 30) return 0;
  return Math.min(duration / 3, 45);
};
