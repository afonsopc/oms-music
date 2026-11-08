/**
 * A geometria da barra do leitor no desktop, em puro (testável no bun).
 *
 * A barra ocupa a janela toda de largura (é a linha de baixo da grelha, por
 * baixo da barra lateral E do painel da direita), por isso o que manda é a
 * largura dela e não o estado dos painéis. O centro (botões + progresso) tem
 * uma largura fixa por janela; os dois lados ficam com o que sobra, iguais,
 * para os botões ficarem mesmo ao centro. O lado direito escolhe um de três
 * "andares" conforme cabe (queixa do dono 2026-11-08: "a bottom bar aqui ta
 * demasiado cramped" - com 8 botões a encolherem até se tocarem):
 *
 *  - full:    tudo à vista (painel, letras, fila, transmitir, volume, DJ,
 *             definições de reprodução, ecrã inteiro);
 *  - compact: letras, fila, transmitir, volume, ecrã inteiro e um "…" com
 *             o painel, o DJ e as definições;
 *  - tight:   fila, transmitir, volume e o "…" com o resto.
 */

export type TransportTier = "full" | "compact" | "tight";

/** Folga lateral da barra e entre as três colunas. */
export const TRANSPORT_PAD_X = 24;
export const TRANSPORT_COLUMN_GAP = 24;

const CENTER_MIN = 380;
const CENTER_MAX = 620;
const CENTER_SHARE = 0.4;

/** Largura que cada lado precisa para o andar (ver TransportBar). */
export const TIER_MIN_SIDE: Record<Exclude<TransportTier, "tight">, number> = {
  full: 460,
  compact: 330,
};

export interface TransportGeometry {
  center: number;
  side: number;
  tier: TransportTier;
}

export const transportGeometry = (barWidth: number): TransportGeometry => {
  const w = Math.max(0, barWidth);
  const center = Math.round(Math.min(CENTER_MAX, Math.max(CENTER_MIN, w * CENTER_SHARE)));
  const side = Math.max(0, Math.floor((w - 2 * TRANSPORT_PAD_X - 2 * TRANSPORT_COLUMN_GAP - center) / 2));
  const tier: TransportTier =
    side >= TIER_MIN_SIDE.full ? "full" : side >= TIER_MIN_SIDE.compact ? "compact" : "tight";
  return { center, side, tier };
};

/** Comprimento do slider do volume por andar: mais curto quando falta espaço. */
export const VOLUME_WIDTH: Record<TransportTier, number> = { full: 96, compact: 72, tight: 64 };
