import { TILE_BY_CODE, isTerminalOrHonour } from '@/tiles/tileset';
import type { Decomposition, HandContext, Meld } from '../hand';
import { isDragonCode, isWindCode } from '../patterns/context';

/**
 * Riichi fu: the minor points that decide what the han doubles.
 *
 * Fu is the part of Riichi scoring everyone gets wrong by hand, because it is
 * an accumulation of small, easily-forgotten contributions - the shape of each
 * triplet, whether it was claimed, what the pair is, how the last tile fitted.
 * It is also mechanical, which makes it exactly the sort of thing worth
 * automating.
 *
 * Two shapes escape the accumulation entirely: seven pairs is a flat 25, and
 * pinfu is a flat 20 by construction, since pinfu is defined as the hand that
 * earns no fu from anything.
 */

const BASE_FU = 20;
const SEVEN_PAIRS_FU = 25;
const MENZEN_RON_BONUS = 10;
const SELF_DRAW_BONUS = 2;
const WAIT_BONUS = 2;
const YAKUHAI_PAIR_BONUS = 2;

export interface FuBreakdown {
  readonly total: number;
  readonly lines: readonly { readonly label: string; readonly fu: number }[];
}

function tripletFu(meld: Meld): number {
  const terminalOrHonour = isTerminalOrHonour(TILE_BY_CODE[meld.tiles[0]]);
  const isKong = meld.kind === 'kong';

  // Each step doubles: open to closed, triplet to kong, simple to terminal.
  let fu = 2;
  if (meld.concealed) fu *= 2;
  if (isKong) fu *= 4;
  if (terminalOrHonour) fu *= 2;
  return fu;
}

function tripletLabel(meld: Meld): string {
  const tile = TILE_BY_CODE[meld.tiles[0]];
  const openness = meld.concealed ? 'Concealed' : 'Melded';
  const kind = meld.kind === 'kong' ? 'kong' : 'triplet';
  const family = isTerminalOrHonour(tile) ? 'terminal/honour' : 'simple';
  return `${openness} ${family} ${kind} (${tile.label})`;
}

export function computeFu(
  reading: Decomposition,
  context: HandContext,
  isPinfu: boolean,
  isConcealedHand: boolean,
): FuBreakdown {
  if (reading.special === 'seven-pairs') {
    return { total: SEVEN_PAIRS_FU, lines: [{ label: 'Seven pairs (fixed)', fu: SEVEN_PAIRS_FU }] };
  }

  if (isPinfu) {
    // Pinfu is 20 fu on a discard and 20 fu self-drawn; the self-draw bonus is
    // exactly what pinfu forgoes in exchange for the han.
    return {
      total: BASE_FU,
      lines: [{ label: 'Pinfu (fixed, no minor points)', fu: BASE_FU }],
    };
  }

  const lines: { label: string; fu: number }[] = [{ label: 'Base', fu: BASE_FU }];
  let total = BASE_FU;

  if (isConcealedHand && !context.selfDrawn) {
    lines.push({ label: 'Concealed hand won on a discard', fu: MENZEN_RON_BONUS });
    total += MENZEN_RON_BONUS;
  }
  if (context.selfDrawn) {
    lines.push({ label: 'Self-drawn', fu: SELF_DRAW_BONUS });
    total += SELF_DRAW_BONUS;
  }

  for (const meld of reading.melds) {
    if (meld.kind === 'chow' || meld.kind === 'pair') continue;
    const fu = tripletFu(meld);
    lines.push({ label: tripletLabel(meld), fu });
    total += fu;
  }

  if (reading.pair) {
    const pairTile = reading.pair.tiles[0];
    let pairFu = 0;
    if (isDragonCode(pairTile)) pairFu += YAKUHAI_PAIR_BONUS;
    if (isWindCode(pairTile)) {
      // A seat wind that is also the round wind scores both roles.
      if (pairTile === context.seatWind) pairFu += YAKUHAI_PAIR_BONUS;
      if (pairTile === context.roundWind) pairFu += YAKUHAI_PAIR_BONUS;
    }
    if (pairFu > 0) {
      lines.push({ label: `Pair of ${TILE_BY_CODE[pairTile].label}`, fu: pairFu });
      total += pairFu;
    }
  }

  if (reading.waitType === 'closed' || reading.waitType === 'edge' || reading.waitType === 'single') {
    const names = { closed: 'Closed wait', edge: 'Edge wait', single: 'Single wait' } as const;
    lines.push({ label: names[reading.waitType], fu: WAIT_BONUS });
    total += WAIT_BONUS;
  }

  // An open hand that somehow totals the bare base is floored at 30 - the
  // "open pinfu" rule, which stops a claimed hand scoring as if it were pinfu.
  if (!isConcealedHand && total === BASE_FU) {
    lines.push({ label: 'Open hand minimum', fu: 10 });
    total += 10;
  }

  const rounded = Math.ceil(total / 10) * 10;
  if (rounded !== total) {
    lines.push({ label: 'Rounded up to the next ten', fu: rounded - total });
  }

  return { total: rounded, lines };
}
