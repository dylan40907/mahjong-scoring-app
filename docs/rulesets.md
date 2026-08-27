# Rulesets

Scoring is data, not code. Every pattern the app can detect lives in one
library keyed by a stable id; a ruleset picks ids out of that library and
attaches numbers to them.

```ts
{
  id: 'taiwanese-common',
  name: 'Taiwanese',
  handSize: 16,
  usesBonusTiles: true,
  requiresYaku: false,
  patterns: {
    'all-pungs':   { value: 4 },
    'half-flush':  { value: 4 },
    'full-flush':  { value: 8 },
    'dragon-pung': { value: 1 },
  },
  payout: { model: 'tai', base: 30, perTai: 10, maxTai: 0, ... },
}
```

That is the whole difference between Taiwanese and Hong Kong scoring: which
ids appear, what they are worth, and which payout model turns the total into
money.

## Pattern values

```ts
interface PatternValue {
  value: number;          // tai, faan, han or points
  openValue?: number;     // value when the hand contains an exposed meld
  concealedOnly?: boolean;// scores nothing unless nothing was claimed
  limit?: number;         // a limit hand; 1 is a yakuman, 2 a double
}
```

`openValue` exists mostly for Riichi, where many yaku halve or vanish on an
open hand. `limit` replaces the accumulated total rather than adding to it,
which is how Hong Kong limit hands and Riichi yakuman both work.

## Payout models

| Model | Total becomes | Discard | Self-draw |
|---|---|---|---|
| `tai` | base + tai × rate | Discarder pays alone | All three pay |
| `faan` | table lookup on faan | Discarder pays double, others the base | All three pay double |
| `riichi` | fu × 2^(2+han), clamped | Discarder pays 4× or 6× base | Split by seat |
| `mcr` | points + 8 per player | Discarder pays value + 8, others 8 | All three pay value + 8 |

## The non-repeat principle

A pattern declares what it absorbs:

```ts
{
  id: 'big-three-dragons',
  supersedes: ['dragon-pung', 'two-dragon-pungs', 'little-three-dragons'],
  detect: (ctx) => (dragonTriplets(ctx).length === 3 ? 1 : 0),
}
```

When both match, only the superseding pattern scores. Big Three Dragons is not
*also* three Dragon Pungs — that would be selling the same three tiles twice.
This is MCR's explicit rule and every other system's implicit one.

## Writing your own

In the app: open any ruleset, tap **Duplicate and Edit**, change the numbers.
Patterns can be switched off entirely. The hand size and payout model come from
the preset it was cloned from, since those change the shape of the game rather
than its prices.

In code, a ruleset is just an object satisfying `RuleSet` in
`mobile/src/scoring/rulesets/types.ts`. Add it to `BUILT_IN_RULESETS` and it
appears everywhere — the library, the session setup, the editor's base list.

Pattern ids are permanent. A saved custom ruleset refers to them by id, so
renaming one silently drops that rule from someone's saved configuration.

## What is not detected

Some patterns depend on information a photograph of a finished hand does not
carry, and are deliberately absent rather than approximated:

- **MCR knitted-tile families** (Knitted Straight, Greater/Lesser Honors and
  Knitted) need the discard record.
- **Riichi ura-dora** is folded into the single dora count on the hand-context
  screen rather than derived.
- **Dealer repeats and counter sticks** are session state; the Riichi payout
  accepts an honba count but the session layer does not yet track it.
