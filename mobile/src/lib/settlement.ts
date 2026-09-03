import type { Settlement } from '@/scoring';

/**
 * Turn a settlement into a per-player ledger.
 *
 * The scoring engine says who pays what in the abstract - "the discarder",
 * "each opponent", "the dealer" - because that is what rulebooks say and
 * because the engine has no notion of a table. A session needs those abstract
 * roles resolved into signed numbers against player ids that sum to zero.
 *
 * Summing to zero is the invariant worth caring about: a rounding rule applied
 * per-payment, as Riichi does, means the winner's credit has to be derived
 * from what was actually paid rather than computed independently. Otherwise a
 * session's standings drift by a hundred points a hand and nobody can see why.
 */
export function computeDeltas(input: {
  players: readonly string[];
  winnerId: string;
  discarderId: string | null;
  dealerId: string;
  settlement: Pick<Settlement, 'payments'>;
}): Record<string, number> {
  const deltas: Record<string, number> = {};
  for (const id of input.players) deltas[id] = 0;

  const chargesDealerSeparately = input.settlement.payments.some((p) => p.from === 'dealer');

  for (const payment of input.settlement.payments) {
    if (payment.from === 'discarder') {
      if (input.discarderId) {
        deltas[input.discarderId] = (deltas[input.discarderId] ?? 0) - payment.amount;
      }
      continue;
    }

    if (payment.from === 'dealer' || payment.from === 'dealer-extra') {
      // Only meaningful when someone other than the dealer won; a dealer who
      // wins does not pay themselves. The two differ in what they do to the
      // 'each-opponent' line below: 'dealer' replaces the dealer's share,
      // 'dealer-extra' is charged on top of it.
      if (input.dealerId !== input.winnerId) {
        deltas[input.dealerId] = (deltas[input.dealerId] ?? 0) - payment.amount;
      }
      continue;
    }

    // 'each-opponent': everyone who has not already been charged by a more
    // specific line.
    for (const id of input.players) {
      if (id === input.winnerId) continue;
      if (id === input.discarderId) continue;
      if (chargesDealerSeparately && id === input.dealerId) continue;
      deltas[id] = (deltas[id] ?? 0) - payment.amount;
    }
  }

  const paidOut = input.players.reduce(
    (sum, id) => (id === input.winnerId ? sum : sum + deltas[id]),
    0,
  );
  deltas[input.winnerId] = -paidOut;
  return deltas;
}
