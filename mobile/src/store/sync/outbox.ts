import { makeId } from '@/lib/ids';

/**
 * Things to tell the server when there is a server to tell.
 *
 * Sessions, hands and seats sync by comparing two copies of a record, which
 * works because a record is a thing that exists on both sides. Friendship is
 * not like that. "Ask Wei to be a friend", "accept that", "unfriend him" are
 * *negotiations with somebody else's account*, carried out through functions
 * on the server rather than by writing a row - there is nothing local to diff,
 * because half of the answer is not ours to hold.
 *
 * So they queue. Each writes its effect on this device at once and drops an
 * intent here; the sync engine drains the queue whenever it can reach the
 * server. The screens never wait, never show a spinner over the network, and
 * never lose a tap to a dead connection.
 *
 * Seats deliberately do not go through here. Which friend sits in which chair
 * is a property of a session we own, so it is a record, and it reconciles by
 * comparing the two copies - see `seats.ts`. That difference matters: a
 * refused intent is eventually abandoned, and a friend who stayed able to see
 * a game after being taken out of it would be the worst way to find that out.
 *
 * Everything in this file is pure. The transport is in `engine.ts`.
 */

export type Intent =
  | {
      readonly kind: 'friend:request';
      /** What they were found under. Only used when there is no id. */
      readonly handle: string;
      /**
       * Who they are, when the request was sent from their profile - which
       * is now always. A username can change between the tap and the signal,
       * and a request sent by name would then reach nobody, or whoever took
       * the name. Optional because requests queued by older builds have none.
       */
      readonly userId?: string;
    }
  | { readonly kind: 'friend:accept'; readonly userId: string }
  | { readonly kind: 'friend:remove'; readonly userId: string }
  | { readonly kind: 'friend:block'; readonly userId: string };

export interface QueuedIntent {
  readonly id: string;
  readonly intent: Intent;
  readonly queuedAt: string;
  /**
   * How many times the server has been asked and said no.
   *
   * Only refusals count. Being offline is not an attempt - a phone in a
   * basement for a week must not exhaust an intent's patience without the
   * server ever having seen it.
   */
  readonly refusals: number;
}

/**
 * How many refusals an intent survives.
 *
 * Some of these can never succeed: a handle that was deleted, a friend who
 * blocked you between the tap and the signal. Retrying those forever would
 * mean one dead intent at the head of the queue is a queue that never drains.
 */
const MAX_REFUSALS = 4;

/**
 * How many intents are kept.
 *
 * A cap that will never be reached by a person and will be reached by a bug.
 * Oldest first, because the recent tap is the one they remember making.
 */
const MAX_QUEUED = 200;

/**
 * What two intents are about, when they are about the same thing.
 *
 * Used to collapse the queue rather than to identify an intent. Everything
 * keys on the account id; only a request from an older build, which never had
 * one, falls back to the username that was typed.
 */
export function subjectOf(intent: Intent): string {
  switch (intent.kind) {
    case 'friend:request':
      return intent.userId
        ? `user:${intent.userId}`
        : `handle:${intent.handle.trim().toLowerCase()}`;
    case 'friend:accept':
    case 'friend:remove':
    case 'friend:block':
      return `user:${intent.userId}`;
  }
}

/**
 * Whether a later intent makes an earlier one pointless.
 *
 * Accepting somebody and then thinking better of it, both while offline, is
 * one decision with a false start, not two things to tell the server. What
 * reaches it has to be the second decision and only the second decision.
 */
function supersedes(later: Intent, earlier: Intent): boolean {
  return subjectOf(later) === subjectOf(earlier);
}

export function enqueue(
  queue: readonly QueuedIntent[],
  intent: Intent,
  now = new Date().toISOString(),
): QueuedIntent[] {
  const kept = queue.filter((queued) => !supersedes(intent, queued.intent));
  const next = [...kept, { id: makeId('q'), intent, queuedAt: now, refusals: 0 }];
  return next.length > MAX_QUEUED ? next.slice(next.length - MAX_QUEUED) : next;
}

/** What the server made of one intent. */
export type Outcome =
  /** It landed, or it was already true. Either way there is nothing left to do. */
  | 'done'
  /** Could not be reached. Not the intent's fault; try again unchanged. */
  | 'unreachable'
  /** The server understood and refused. A few of these and it is abandoned. */
  | 'refused';

/**
 * Apply a drain's results.
 *
 * Anything not mentioned is left exactly as it was, so a drain that stopped
 * halfway - the connection went, the app was backgrounded - keeps the rest of
 * the queue intact rather than losing it or replaying it.
 */
export function applyOutcomes(
  queue: readonly QueuedIntent[],
  outcomes: ReadonlyMap<string, Outcome>,
): QueuedIntent[] {
  const next: QueuedIntent[] = [];
  for (const queued of queue) {
    const outcome = outcomes.get(queued.id);
    if (outcome === 'done') continue;
    if (outcome === 'refused') {
      const refusals = queued.refusals + 1;
      if (refusals >= MAX_REFUSALS) continue;
      next.push({ ...queued, refusals });
      continue;
    }
    next.push(queued);
  }
  return next;
}
