import { applyOutcomes, enqueue, subjectOf, type Intent, type QueuedIntent } from '../outbox';

/**
 * The queue that makes social actions work in a basement.
 *
 * Mahjong is played where there is no signal, so every one of these taps
 * happens offline at some point and has to arrive later, once, saying the same
 * thing it said at the time. The failures are all quiet: an intent that
 * collapses wrongly is a friend request nobody sent or an unfriending that
 * never happened, and a refusal that never expires is a queue that stops
 * draining for good.
 */

const at = (n: number) => `2026-09-04T00:0${n}:00.000Z`;

function queueOf(...intents: Intent[]): QueuedIntent[] {
  return intents.reduce<QueuedIntent[]>((queue, intent, i) => enqueue(queue, intent, at(i)), []);
}

describe('collapsing', () => {
  it('lets a removal overtake an unsent acceptance', () => {
    // Accepted, thought better of it, both while offline. What reaches the
    // server has to be the second decision and only the second decision.
    const queue = queueOf(
      { kind: 'friend:accept', userId: 'u2' },
      { kind: 'friend:remove', userId: 'u2' },
    );
    expect(queue).toHaveLength(1);
    expect(queue[0].intent.kind).toBe('friend:remove');
  });

  it('does not collapse two different people', () => {
    const queue = queueOf(
      { kind: 'friend:accept', userId: 'u2' },
      { kind: 'friend:accept', userId: 'u3' },
    );
    expect(queue).toHaveLength(2);
  });

  it('sends one request however many times it was tapped', () => {
    const queue = queueOf(
      { kind: 'friend:request', handle: 'Ada' },
      { kind: 'friend:request', handle: 'ada' },
    );
    expect(queue).toHaveLength(1);
  });

  it('names a request by account when it has one', () => {
    // A request sent from a profile carries the id, so a later removal of the
    // same person - taking it back while still offline - collapses onto it
    // instead of both being sent.
    const queue = queueOf(
      { kind: 'friend:request', handle: 'ada', userId: 'u_ada' },
      { kind: 'friend:remove', userId: 'u_ada' },
    );
    expect(queue).toHaveLength(1);
    expect(queue[0].intent.kind).toBe('friend:remove');
  });

  it('is not fooled by a username changing', () => {
    // Same person, renamed between two taps: still one subject.
    expect(subjectOf({ kind: 'friend:request', handle: 'ada', userId: 'u_ada' })).toBe(
      subjectOf({ kind: 'friend:request', handle: 'ada_l', userId: 'u_ada' }),
    );
  });

  it('treats a handle and an account id as different ways to name someone', () => {
    // An unsent request has never had an id to collapse against, which is why
    // requests key on what was typed.
    expect(subjectOf({ kind: 'friend:request', handle: 'Ada' })).toBe('handle:ada');
    expect(subjectOf({ kind: 'friend:remove', userId: 'ada' })).toBe('user:ada');
  });
});

describe('draining', () => {
  it('leaves everything it did not get to', () => {
    // A drain interrupted halfway - backgrounded, connection dropped - must
    // not lose the rest of the queue or replay what already landed.
    const queue = queueOf(
      { kind: 'friend:request', handle: 'ada' },
      { kind: 'friend:request', handle: 'grace' },
    );
    const next = applyOutcomes(queue, new Map([[queue[0].id, 'done']]));
    expect(next).toHaveLength(1);
    expect(next[0].intent).toMatchObject({ handle: 'grace' });
  });

  it('does not hold being offline against an intent', () => {
    const queue = queueOf({ kind: 'friend:request', handle: 'ada' });
    let next = queue;
    for (let i = 0; i < 20; i += 1) {
      next = applyOutcomes(next, new Map([[next[0].id, 'unreachable']]));
    }
    // A phone in a drawer for a fortnight has not used up its attempts.
    expect(next).toHaveLength(1);
    expect(next[0].refusals).toBe(0);
  });

  it('gives up on something the server keeps refusing', () => {
    // A handle that has since been deleted can never succeed, and one dead
    // intent must not be a queue that never drains again.
    let queue = queueOf({ kind: 'friend:request', handle: 'gone' });
    for (let i = 0; i < 4 && queue.length > 0; i += 1) {
      queue = applyOutcomes(queue, new Map([[queue[0].id, 'refused']]));
    }
    expect(queue).toHaveLength(0);
  });
});

describe('bounds', () => {
  it('keeps the newest when something has gone wrong', () => {
    let queue: QueuedIntent[] = [];
    for (let i = 0; i < 260; i += 1) {
      queue = enqueue(queue, { kind: 'friend:request', handle: `p${i}` }, at(0));
    }
    expect(queue).toHaveLength(200);
    expect(queue[queue.length - 1].intent).toMatchObject({ handle: 'p259' });
  });
});
