import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  BodyStrong,
  Button,
  Caption,
  CaptionStrong,
  Divider,
  EmptyState,
  PageHeader,
  Panel,
  Row,
  Screen,
  Section,
  Title,
} from '@/design/components';
import { FriendsIcon, PersonIcon, SparkIcon, TrophyIcon } from '@/design/icons';
import { colors, space } from '@/design/tokens';
import { BestHandTiles } from '@/components/BestHandTiles';
import { findRuleSet } from '@/store/store';
import {
  acceptFriend,
  blockUser,
  lookupProfile,
  lookupProfileById,
  removeFriend,
  requestFriend,
  type PublicProfile,
} from '@/store/friends';
import { syncNow } from '@/store/sync/engine';
import { relativeDate, signed } from '@/lib/format';
import type { TileCode } from '@/tiles/tileset';

/**
 * Somebody else's profile.
 *
 * The same things the profile screen shows about you, which is the point: a
 * profile is public by default and what it shows is what its owner sees, so
 * there is no second idea of "the public version" to keep in step.
 *
 * Opened two ways. From search, by the username that was just found. From the
 * friends list, by account id (`?id=`), and only by id: the username in that
 * list is whatever it was at the last sync, and if the friend has renamed since
 * and somebody else has taken the old name, falling back to it would open a
 * stranger's page with a friend's name on the way in.
 *
 * A username that does not exist and a username that is private answer the
 * same way. That is deliberate - if the two answers differed, the difference
 * would itself tell a stranger that somebody is there and hiding.
 */
export default function PublicProfileScreen() {
  const router = useRouter();
  const { handle, id } = useLocalSearchParams<{ handle: string; id?: string }>();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  /** Bumped to ask for a fresh read after sending or accepting a request. */
  const [reloads, setReloads] = useState(0);

  /*
   * Nothing is set until the answer comes back.
   *
   * Not because of a lint rule: a synchronous setState here re-renders before
   * the request has even left, and the `alive` flag is what stops a slow reply
   * for a name you have already navigated away from overwriting the one you
   * are looking at.
   */
  useEffect(() => {
    let alive = true;
    const read = id ? lookupProfileById(id) : lookupProfile(handle ?? '');
    void read.then((found) => {
      if (!alive) return;
      setProfile(found);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [handle, id, reloads]);

  const load = useCallback(() => setReloads((n) => n + 1), []);

  // After ending a friendship there is nothing left here for us, and the list
  // we came from is where the change shows.
  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/friends');
  }, [router]);

  if (loading) {
    return (
      <Screen motif="rings">
        <Stack.Screen options={{ headerShown: false }} />
        <PageHeader>
          <Title>{handle}</Title>
        </PageHeader>
      </Screen>
    );
  }

  if (!profile) {
    return (
      <Screen motif="rings">
        <Stack.Screen options={{ headerShown: false }} />
        <PageHeader>
          <Title>{handle}</Title>
        </PageHeader>
        <EmptyState
          icon={<PersonIcon size={28} color={colors.inkFaint} />}
          title={id ? 'This profile is not available' : 'Nobody by that name'}
          body={
            id
              ? 'They may have made their profile private.'
              : 'Check the spelling. Somebody with a private profile cannot be found.'
          }
        />
      </Screen>
    );
  }

  const stats = profile.stats;
  const best = stats.best ?? null;

  return (
    <Screen scroll motif="rings" padded={false}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader>
        <Title>{profile.displayName || profile.handle}</Title>
        <Caption tone="faint">{profile.handle}</Caption>
      </PageHeader>

      <View style={styles.body}>
        <Relation profile={profile} note={note} onNote={setNote} onChanged={load} />

        <Section title="Best hand" icon={<TrophyIcon size={15} color={colors.brass} />}>
          {best ? (
            <Panel style={styles.best}>
              <BestHandTiles
                groups={best.groups as TileCode[][] | null | undefined}
                tiles={best.tiles as TileCode[]}
              />
              <View style={styles.bestLine}>
                <BodyStrong tone="accent" numeric>
                  {best.total} {best.unit}
                </BodyStrong>
                <Caption tone="faint">{relativeDate(best.at)}</Caption>
              </View>
              {best.patterns.length > 0 ? (
                <Caption tone="muted">{best.patterns.join(' · ')}</Caption>
              ) : null}
              <Caption tone="faint">{findRuleSet(best.ruleSetId)?.name ?? ''}</Caption>
            </Panel>
          ) : (
            <Panel style={styles.empty}>
              <SparkIcon size={24} color={colors.inkFaint} />
              <Caption tone="faint">Nothing to show yet.</Caption>
            </Panel>
          )}
        </Section>

        <Section title="All time">
          <Panel flush>
            <Row title="Hands won" value={String(stats.handsWon ?? 0)} />
            <Divider inset={space.lg} />
            <Row title="Hands played" value={String(stats.handsPlayed ?? 0)} />
            <Divider inset={space.lg} />
            <Row title="Sessions" value={String(stats.sessions ?? 0)} />
            <Divider inset={space.lg} />
            <Row title="Net" value={signed(stats.net ?? 0)} />
          </Panel>
        </Section>

        <Section title="Friends" icon={<FriendsIcon size={15} color={colors.inkFaint} />}>
          <Panel flush>
            <Row title="People they play with" value={String(profile.friendCount)} />
          </Panel>
        </Section>

        {profile.relation === 'friend' ? <FriendActions profile={profile} onDone={leave} /> : null}
      </View>
    </Screen>
  );
}

/** What you can do about this person, which depends on where you already stand. */
function Relation({
  profile,
  note,
  onNote,
  onChanged,
}: {
  profile: PublicProfile;
  note: string | null;
  onNote: (note: string | null) => void;
  onChanged: () => void;
}) {
  if (profile.relation === 'self') return null;

  // What happened, said once the answer is in: "sent" is only true once it
  // has gone, and offline it waits in the queue and goes on its own.
  const act = (run: () => void, said: string) => {
    run();
    void syncNow().then((outcome) => {
      onNote(outcome === 'offline' ? 'Saved. It goes as soon as you are back online.' : said);
      onChanged();
    });
  };

  return (
    <Panel style={styles.relation}>
      {profile.relation === 'friend' ? (
        <CaptionStrong tone="accent">You are friends.</CaptionStrong>
      ) : profile.relation === 'requested' ? (
        <CaptionStrong tone="muted">Friend request sent.</CaptionStrong>
      ) : profile.relation === 'incoming' ? (
        <>
          <CaptionStrong tone="muted">They sent you a friend request.</CaptionStrong>
          <Button
            label="Accept"
            variant="primary"
            block
            onPress={() => act(() => acceptFriend(profile.id), 'Accepted.')}
          />
        </>
      ) : (
        <Button
          label="Send friend request"
          variant="primary"
          block
          onPress={() =>
            act(
              () => requestFriend(profile),
              'Friend request sent.',
            )
          }
        />
      )}
      {note ? <Caption tone="muted">{note}</Caption> : null}
    </Panel>
  );
}

/**
 * Ending a friendship, at the bottom of the friend's own page.
 *
 * These used to be a menu that opened when a friend was tapped in the list, so
 * "Block" and "Remove friend" stood between you and their profile every time
 * you only wanted to look at it. Here they are after everything you came to
 * see, where somebody looking for them will find them, and only on the page of
 * somebody who is actually a friend.
 */
function FriendActions({ profile, onDone }: { profile: PublicProfile; onDone: () => void }) {
  const name = profile.displayName || profile.handle || 'them';

  const confirmRemove = () =>
    Alert.alert(
      `Remove ${name}?`,
      'They stop seeing the games you put them in, and you stop seeing theirs. Nothing already scored changes.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeFriend(profile.id);
            void syncNow();
            onDone();
          },
        },
      ],
    );

  const confirmBlock = () =>
    Alert.alert(
      `Block ${name}?`,
      'They are removed as a friend, stop seeing any game you put them in, and can no longer find you or send you a request.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => {
            blockUser(profile.id);
            void syncNow();
            onDone();
          },
        },
      ],
    );

  return (
    <View style={styles.actions}>
      <Button label="Remove friend" block onPress={confirmRemove} />
      <Button label="Block" variant="danger" block onPress={confirmBlock} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.xl },
  relation: { gap: space.sm },
  best: { gap: space.sm },
  bestLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  actions: { gap: space.sm, marginTop: space.xxxl },
});
