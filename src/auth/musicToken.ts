/** O token de uma sessão da própria app de música (login pelo id). Puro, para os testes. */
export const MUSIC_TOKEN_PREFIX = "omsm_";

export const isMusicToken = (token: string | null | undefined): boolean =>
  typeof token === "string" && token.startsWith(MUSIC_TOKEN_PREFIX);
