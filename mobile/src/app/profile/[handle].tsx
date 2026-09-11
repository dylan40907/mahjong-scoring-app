import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
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
  TileFace,
  Title,
} from '@/design/components';
import { FriendsIcon, PersonIcon, SparkIcon, TrophyIcon } from '@/design/icons';
import { colors, space, tileSize } from '@/design/tokens';
import { findRuleSet } from '@/store/store';
import { acceptFriend, lookupProfile, requestFriend, type PublicProfile } from '@/store/friends';
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
 * A username that does not exist and a username that is private answer the
 * same way. That is deliberate - if the two answers differed, the difference
 * would itself tell a stranger that somebody is there and hiding.
 */
export default function PublicProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
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
    void lookupProfile(handle ?? '').then((found) => {
      if (!alive) return;
      setProfile(found);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [handle, reloads]);

  const load = useCallback(() => setReloads((n) => n + 1), []);

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
          title="Nobody by that name"
          body="Check the spelling. Somebody with a private profile cannot be found."
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
              <View style={styles.bestTiles}>
                {best.tiles.slice(0, 9).map((code, index) => (
                  <TileFace key={`${code}-${index}`} code={code as TileCode} width={tileSize.sm} />
                ))}
              </View>
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

  const act = (run: () => void, said: string) => {
    run();
    onNote(said);
    void syncNow().then(onChanged);
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
              () => requestFriend(profile.handle ?? ''),
              'Sent. They will see it next time you are both online.',
            )
          }
        />
      )}
      {note ? <Caption tone="muted">{note}</Caption> : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.xl },
  relation: { gap: space.sm },
  best: { gap: space.sm },
  bestTiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  bestLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
});
