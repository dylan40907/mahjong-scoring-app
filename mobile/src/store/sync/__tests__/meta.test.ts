import { isDirty, markSynced, pruneTombstones, touch, winner } from '../meta';

/**
 * The rules that decide what reaches the server and what survives a conflict.
 *
 * Both failures here are silent: a record that never looks dirty is a record
 * that never syncs, and a tombstone dropped too early is a deleted session
 * walking back onto somebody's phone.
 */

describe('dirtiness', () => {
  it('is a record the server has not acknowledged in its current state', () => {
    const fresh = touch({ id: 'a' });
    expect(isDirty(fresh)).toBe(true);

    const pushed = markSynced(fresh);
    expect(isDirty(pushed)).toBe(false);

    // Any later edit re-dirties it without anyone setting a flag.
    expect(isDirty(touch(pushed, '2026-09-04T00:00:00.000Z'))).toBe(true);
  });

  it('survives being killed between the push and the acknowledgement', () => {
    // Nothing is written until the server answers, so a record pushed but not
    // acknowledged is still dirty and simply goes again.
    const pushed = touch({ id: 'a' }, '2026-09-03T00:00:00.000Z');
    expect(isDirty(pushed)).toBe(true);
  });
});

describe('who wins a conflict', () => {
  const local = { id: 'a', updatedAt: '2026-09-03T10:00:00.000Z' };

  it('takes the later edit', () => {
    const remote = { id: 'a', updatedAt: '2026-09-03T11:00:00.000Z' };
    expect(winner(local, remote)).toBe(remote);
  });

  it('keeps the local copy when it is the later one', () => {
    const remote = { id: 'a', updatedAt: '2026-09-03T09:00:00.000Z' };
    expect(winner(local, remote)).toBe(local);
  });

  it('keeps the local copy on an exact tie, so a pull cannot oscillate', () => {
    expect(winner(local, { ...local })).toBe(local);
  });
});

describe('tombstones', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-09-03T00:00:00.000Z');

  it('keeps a recent delete', () => {
    const stones = [{ id: 's1', deletedAt: new Date(now - 10 * day).toISOString() }];
    expect(pruneTombstones(stones, now)).toHaveLength(1);
  });

  it('forgets one old enough that no device can still be behind it', () => {
    const stones = [{ id: 's1', deletedAt: new Date(now - 200 * day).toISOString() }];
    expect(pruneTombstones(stones, now)).toHaveLength(0);
  });

  it('keeps one whose date it cannot read', () => {
    // Forgetting a delete resurrects data; keeping a stray forty bytes does not.
    expect(pruneTombstones([{ id: 's1', deletedAt: 'not a date' }], now)).toHaveLength(1);
  });
});
