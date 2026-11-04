/**
 * Hápticos (iOS e Android): um toque leve ao escolher, um "feito" ao gostar
 * ou guardar, um impacto ao abrir um menu com o dedo. Nunca bloqueiam nem
 * rebentam: sem motor de vibração, não acontece nada. A web tem o par
 * haptics.web.ts, que não faz nada.
 */
import * as Haptics from "expo-haptics";

const safe = (p: Promise<void>): void => {
  p.catch(() => {});
};

export const haptics = {
  /** Mudar de separador, escolher uma opção. */
  select: (): void => safe(Haptics.selectionAsync()),
  /** Tocar em play, abrir o leitor. */
  tap: (): void => safe(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Pressão longa: abrir um menu. */
  press: (): void => safe(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Gostar, guardar, acabou de enviar. */
  success: (): void => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Algo falhou. */
  error: (): void => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
