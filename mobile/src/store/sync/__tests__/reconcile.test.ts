import { reconcile, type LocalState, type RemoteState } from '../reconcile';
import type { Session } from '../../types';

/**
 * The cases where sync gets data wrong quietly.
 *
 * Every failure mode here is silent. A record that never counts as dirty never
 * reaches the server and nobody finds out until they open a second phone. A
 * losing copy that wins overwrites the newer one with no error. A dropped
 * tombstone puts a deleted session back on somebody's device days later. None
 * of it throws, so none of it shows up any other way.
 */

function session(id: string, updatedAt: string, syncedAt?: string | null): Session {
  return {
    id,
    name: id,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt,
    syncedAt: syncedAt ?? null,
    ruleSetId: 'taiwanese-common',
    players: [],
    roundWind: 'east',
    dealerId: '',
    hands: [],
  };
}

const empty: LocalState & RemoteState = { sessions: [], tombstones: [] };

describe('a session that only exists in one place', () => {
  it('is pushed when it is new here', () => {
    const mine = session('s1', '2026-09-03T10:00:00.000Z');
    const out = reconcile({ sessions: [mine], tombstones: [] }, empty);

    expect(out.push.map((s) => s.id)).toEqual(['s1']);
    expect(out.keep.map((s) => s.id)).toEqual(['s1']);
  });

  it('is not pushed again once the server has acknowledged it', () => {
    const at = '2026-09-03T10:00:00.000Z';
    const clean = session('s1', at, at);
    const out = reconcile({ sessions: [clean], tombstones: [] }, empty);

    expect(out.push).toEqual([]);
    expect(out.keep.map((s) => s.id)).toEqual(['s1']);
  });

  it('is taken when it is new on the server', () => {
    const theirs = session('s2', '2026-09-03T10:00:00.000Z');
    const out = reconcile(empty, { sessions: [theirs], tombstones: [] });

    expect(out.keep.map((s) => s.id)).toEqual(['s2']);
    expect(out.push).toEqual([]);
  });
});

describe('the same session edited in two places', () => {
  it('keeps the later edit and does not push the copy that lost', () => {
    const mine = session('s1', '2026-09-03T10:00:00.000Z');
    const theirs = session('s1', '2026-09-03T12:00:00.000Z');
    const out = reconcile({ sessions: [mine], tombstones: [] }, { sessions: [theirs], tombstones: [] });

    expect(out.keep[0].updatedAt).toBe('2026-09-03T12:00:00.000Z');
    expect(out.push).toEqual([]);
  });

  it('pushes the local copy when this device holds the later edit', () => {
    const mine = session('s1', '2026-09-03T14:00:00.000Z');
    const theirs = session('s1', '2026-09-03T12:00:00.000Z');
    const out = reconcile({ sessions: [mine], tombstones: [] }, { sessions: [theirs], tombstones: [] });

    expect(out.keep[0].updatedAt).toBe('2026-09-03T14:00:00.000Z');
    expect(out.push.map((s) => s.id)).toEqual(['s1']);
  });
});

describe('deletes', () => {
  it('travels to the server', () => {
    const out = reconcile(
      { sessions: [], tombstones: [{ id: 's1', deletedAt: '2026-09-03T10:00:00.000Z' }] },
      empty,
    );
    expect(out.pushDeletes).toEqual(['s1']);
  });

  it('is not pushed twice once the server has it', () => {
    const stone = { id: 's1', deletedAt: '2026-09-03T10:00:00.000Z' };
    const out = reconcile({ sessions: [], tombstones: [stone] }, { sessions: [], tombstones: [stone] });
    expect(out.pushDeletes).toEqual([]);
  });

  it('removes the session here when another device deleted it', () => {
    const mine = session('s1', '2026-09-03T10:00:00.000Z');
    const out = reconcile(
      { sessions: [mine], tombstones: [] },
      { sessions: [], tombstones: [{ id: 's1', deletedAt: '2026-09-03T11:00:00.000Z' }] },
    );

    expect(out.keep).toEqual([]);
    expect(out.dropLocal).toEqual(['s1']);
    expect(out.learnedDeletes.map((s) => s.id)).toEqual(['s1']);
  });

  it('beats an edit even when the edit is newer', () => {
    // Deliberate: a session that will not stay deleted is worse than an edit
    // lost to something already thrown away, and comparing the two timestamps
    // lets a device with a slow clock resurrect data.
    const editedLater = session('s1', '2026-09-03T23:00:00.000Z');
    const out = reconcile(
      { sessions: [editedLater], tombstones: [] },
      { sessions: [], tombstones: [{ id: 's1', deletedAt: '2026-09-03T09:00:00.000Z' }] },
    );

    expect(out.keep).toEqual([]);
    expect(out.push).toEqual([]);
  });

  it('does not resurrect a session the server still has but this device deleted', () => {
    const theirs = session('s1', '2026-09-03T12:00:00.000Z');
    const out = reconcile(
      { sessions: [], tombstones: [{ id: 's1', deletedAt: '2026-09-03T10:00:00.000Z' }] },
      { sessions: [theirs], tombstones: [] },
    );

    expect(out.keep).toEqual([]);
    expect(out.pushDeletes).toEqual(['s1']);
  });
});

describe('a device that has been away for a week', () => {
  it('sends what it did, takes what it missed, and loses nothing', () => {
    const madeOffline = session('mine', '2026-09-03T10:00:00.000Z');
    const alsoEditedElsewhere = session('shared', '2026-09-01T10:00:00.000Z');
    const theirsNewer = session('shared', '2026-09-02T10:00:00.000Z');
    const theirsNew = session('theirs', '2026-09-02T11:00:00.000Z');

    const out = reconcile(
      { sessions: [madeOffline, alsoEditedElsewhere], tombstones: [] },
      { sessions: [theirsNewer, theirsNew], tombstones: [] },
    );

    expect(out.keep.map((s) => s.id).sort()).toEqual(['mine', 'shared', 'theirs']);
    expect(out.push.map((s) => s.id)).toEqual(['mine']);
    expect(out.keep.find((s) => s.id === 'shared')!.updatedAt).toBe('2026-09-02T10:00:00.000Z');
  });
});
