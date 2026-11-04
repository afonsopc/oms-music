/** Na web não há hápticos (ver haptics.ts). */
const none = (): void => {};

export const haptics = { select: none, tap: none, press: none, success: none, error: none };
