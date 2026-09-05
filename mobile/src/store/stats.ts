import type { AwayGame, HandRecord, Session, SessionPlayer } from './types';
import type { TileCode } from '@/tiles/tileset';

/**
 * What a person's history adds up to, across every table they sat at.
 *
 * Two things make this less obvious than summing a list. A session holds four
 * seats and only one of them is you, so "hands scored" and "hands won" are
 * different numbers and the second one needs to know which seat you were. And
 * a game can arrive from somebody else's phone, in which case you are in it
 * without owning any of it.
 *
 * Pure, and separate from the store, because it is the arithmetic behind the
 * profile screen and every one of its mistakes is a plausible-looking number.
 */

export interface Identity {
  readonly userId: string | null;
  readonly displayName: string | null;
}

/** A game to count, whoever typed it in. */
export interface PlayedGame {
  readonly session: Session;
  /** True when somebody else scored it and we were seated in it. */
  readonly away: boolean;
}

/**
 * Which seat is this person.
 *
 * A linked account is the real answer and the only one that works when
 * somebody else scored the game. Falling back to the name is not a guess: the
 * app puts the account's own display name into seat one of every session it
 * creates, so on this device that name *is* the identification, and it is what
 * every session written before seats could be linked has to go on.
 *
 * The fallback deliberately does not apply to a seat that is already linked to
 * somebody else - two people called Sam is a coincidence, not a claim.
 */
export function mySeat(session: Session, me: Identity): SessionPlayer | undefined {
  const linked = session.players.find((player) => player.accountId && player.accountId === me.userId);
  if (linked) return linked;
  const name = me.displayName?.trim();
  if (!name) return undefined;
  return session.players.find((player) => !player.accountId && player.name.trim() === name);
}

export interface PlayerStats {
  /** Hands scored at a table we were at, whether or not we won them. */
  readonly handsPlayed: number;
  /** Hands we took. Only countable where we know which seat we were. */
  readonly handsWon: number;
  readonly sessions: number;
  /** Sessions somebody else scored. Part of `sessions`, not on top of it. */
  readonly awaySessions: number;
  /** Points up or down across everything, in whatever each ruleset counts in. */
  readonly net: number;
  /** True when no seat anywhere identifies us, so `handsWon` and `net` are 0. */
  readonly unidentified: boolean;
}

export function playerStats(games: readonly PlayedGame[], me: Identity): PlayerStats {
  let handsPlayed = 0;
  let handsWon = 0;
  let net = 0;
  let awaySessions = 0;
  let identified = false;

  for (const game of games) {
    handsPlayed += game.session.hands.length;
    if (game.away) awaySessions += 1;

    const seat = mySeat(game.session, me);
    if (!seat) continue;
    identified = true;
    for (const hand of game.session.hands) {
      if (hand.winnerId === seat.id) handsWon += 1;
      net += hand.deltas[seat.id] ?? 0;
    }
  }

  return {
    handsPlayed,
    handsWon,
    sessions: games.length,
    awaySessions,
    net,
    unidentified: !identified,
  };
}

export interface BestHand {
  readonly record: HandRecord;
  readonly ruleSetId: string;
  readonly tiles: TileCode[];
  /** True when it was scored on somebody else's phone. */
  readonly away: boolean;
}

/**
 * The hand to put on a profile.
 *
 * Hands *we won*, which is not what this used to do: it took the highest score
 * in any session on the device, so a profile could show off a hand somebody
 * else made at our table. Where no seat identifies us at all there is nothing
 * honest to show, and showing nothing is the right answer - the profile says
 * so and offers the fix.
 *
 * Highest score for now, which is the obvious pick and a bit boring: for
 * anyone who has ever had a limit hand it is that hand forever. Rarity - how
 * uncommon a hand's best pattern is across this player's own history - makes
 * the better story and is the intended default once there is enough history to
 * measure it against.
 */
export function bestHandFor(games: readonly PlayedGame[], me: Identity): BestHand | null {
  let best: BestHand | null = null;
  for (const game of games) {
    const seat = mySeat(game.session, me);
    if (!seat) continue;
    for (const record of game.session.hands) {
      if (record.winnerId !== seat.id) continue;
      if (best && record.summary.total <= best.record.summary.total) continue;
      best = {
        record,
        ruleSetId: game.session.ruleSetId,
        tiles: [...(record.hand.exposed ?? []), ...record.hand.concealed],
        away: game.away,
      };
    }
  }
  return best;
}

/** Owned sessions and away games as one list, newest first. */
export function playedGames(
  sessions: readonly Session[],
  away: readonly AwayGame[],
): PlayedGame[] {
  const games: PlayedGame[] = [
    ...sessions.map((session) => ({ session, away: false })),
    ...away.map((game) => ({ session: game.session, away: true })),
  ];
  games.sort((a, b) => b.session.createdAt.localeCompare(a.session.createdAt));
  return games;
}
