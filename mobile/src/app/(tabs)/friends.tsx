import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Body,
  Button,
  Caption,
  Divider,
  EmptyState,
  Panel,
  Row,
  Screen,
  Section,
  TextField,
} from '@/design/components';
import { CheckIcon, FriendsIcon, PersonIcon } from '@/design/icons';
import { colors, space } from '@/design/tokens';
import {
  MIN_SEARCH,
  acceptFriend,
  acceptedFriends,
  blockUser,
  incomingRequests,
  outgoingRequests,
  removeFriend,
  searchProfiles,
  stillMatches,
  useFriends,
  type Friend,
  type SearchOutcome,
  type SearchResult,
} from '@/store/friends';
import { useAccount } from '@/store/account';
import { syncNow } from '@/store/sync/engine';
import { isCloudConfigured } from '@/lib/supabase';

/**
 * Friends.
 *
 * A tab rather than a section of the profile, because it is a place you go
 * rather than a setting you change: finding somebody, answering a request,
 * opening a profile. As a panel on the profile screen it was one row deep and
 * gave no hint that any of that existed.
 *
 * People are found by searching, which is what every other app does and what
 * this one needed: usernames here are made from the front of an email address,
 * so the person you are looking for does not know theirs either. The limits
 * that stop a search box turning into a directory are on the server, in
 * `search_profiles`, and are not repeated here.
 */
export default function FriendsScreen() {
  const router = useRouter();
  const friends = useFriends(useCallback((state) => state.friends, []));
  const status = useAccount(useCallback((account) => account.status, []));

  const accepted = acceptedFriends(friends);
  const incoming = incomingRequests(friends);
  const outgoing = outgoingRequests(friends);

  if (!isCloudConfigured()) {
    return (
      <Screen motif="wall">
        <EmptyState
          icon={<FriendsIcon size={28} color={colors.inkFaint} />}
          title="No account server"
          body="This build cannot reach one, so there is nobody to add."
        />
      </Screen>
    );
  }

  /*
   * Signed out, this tab is a signpost and nothing else.
   *
   * Not a search field that fails after you type a name into it: a friend list
   * needs an account at both ends, and the honest version says so before the
   * typing rather than after.
   */
  if (status !== 'identified') {
    return (
      <Screen motif="wall">
        <EmptyState
          icon={<FriendsIcon size={28} color={colors.inkFaint} />}
          title="Friends need an account"
          body="Make an account and you can add the people you play with. Every game you are in shows up for both of you."
          action={
            <Button
              label="Go to Profile"
              variant="primary"
              onPress={() => router.push('/(tabs)/profile')}
            />
          }
        />
      </Screen>
    );
  }

  const confirmRemove = (friend: Friend) => {
    Alert.alert(
      `Remove ${nameOf(friend)}?`,
      'They stop seeing the games you put them in, and you stop seeing theirs. Nothing already scored changes.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeFriend(friend.id);
            void syncNow();
          },
        },
      ],
    );
  };

  const openFriend = (friend: Friend) => {
    Alert.alert(nameOf(friend), friend.handle ?? undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'View profile',
        onPress: () => {
          if (friend.handle) router.push(`/profile/${friend.handle}`);
        },
      },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () => {
          blockUser(friend.id);
          void syncNow();
        },
      },
      { text: 'Remove friend', style: 'destructive', onPress: () => confirmRemove(friend) },
    ]);
  };

  return (
    <Screen scroll motif="wall">
      <FindSomeone />

      {incoming.length > 0 ? (
        <Section title="Friend requests" note={String(incoming.length)}>
          <Panel flush>
            {incoming.map((friend, index) => (
              <View key={friend.id}>
                {index > 0 ? <Divider inset={space.lg} /> : null}
                <Row
                  title={nameOf(friend)}
                  subtitle={friend.handle ?? undefined}
                  trailing={
                    <View style={styles.answer}>
                      <Button
                        label="Accept"
                        variant="primary"
                        onPress={() => {
                          acceptFriend(friend.id);
                          void syncNow();
                        }}
                      />
                      {/* No confirmation: turning down a request takes
                          nothing away from anybody, and they can ask again. */}
                      <Button
                        label="Decline"
                        onPress={() => {
                          removeFriend(friend.id);
                          void syncNow();
                        }}
                      />
                    </View>
                  }
                  chevron={false}
                />
              </View>
            ))}
          </Panel>
        </Section>
      ) : null}

      <Section title="Friends" icon={<PersonIcon size={15} color={colors.inkFaint} />}>
        {accepted.length === 0 ? (
          <Panel style={styles.empty}>
            <Body tone="muted">Nobody yet.</Body>
            <Caption tone="faint">Search for someone above and send them a friend request.</Caption>
          </Panel>
        ) : (
          <Panel flush>
            {accepted.map((friend, index) => (
              <View key={friend.id}>
                {index > 0 ? <Divider inset={space.lg} /> : null}
                <Row
                  title={nameOf(friend)}
                  subtitle={friend.handle ?? undefined}
                  trailing={
                    friend.local ? <CheckIcon size={16} color={colors.inkFaint} /> : undefined
                  }
                  onPress={() => openFriend(friend)}
                />
              </View>
            ))}
          </Panel>
        )}
      </Section>

      {outgoing.length > 0 ? (
        <Section title="Requests you sent">
          <Panel flush>
            {outgoing.map((friend, index) => (
              <View key={friend.id}>
                {index > 0 ? <Divider inset={space.lg} /> : null}
                <Row
                  title={nameOf(friend)}
                  subtitle={friend.local ? 'Sends when you are back online' : undefined}
                  trailing={
                    <Button
                      label="Cancel"
                      onPress={() => {
                        removeFriend(friend.id);
                        void syncNow();
                      }}
                    />
                  }
                  chevron={false}
                />
              </View>
            ))}
          </Panel>
        </Section>
      ) : null}
    </Screen>
  );
}

/**
 * The search box, and whoever it has found so far.
 *
 * Asks a quarter of a second after the last key rather than on every one:
 * each question spends a little of an hourly allowance, and a fast typist
 * would otherwise spend six of them on one name. While an answer is on its
 * way, the last one stays up narrowed to what still matches, so typing a
 * letter never blanks the list and then refills it.
 */
function FindSomeone() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<{ query: string; outcome: SearchOutcome } | null>(null);

  const wanted = query.trim().toLowerCase().replace(/^@/, '');
  const searching = wanted.length >= MIN_SEARCH;

  /*
   * State is only ever set when a reply lands, never synchronously here: a
   * reply for a query that has since changed is thrown away by `alive`, which
   * is what stops a slow answer for "we" overwriting a fast one for "wei".
   */
  useEffect(() => {
    if (wanted.length < MIN_SEARCH) return;
    let alive = true;
    const timer = setTimeout(() => {
      void searchProfiles(wanted).then((outcome) => {
        if (alive) setAnswer({ query: wanted, outcome });
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [wanted]);

  const current = answer?.query === wanted ? answer.outcome : null;
  const results: SearchResult[] = !searching
    ? []
    : current?.kind === 'results'
      ? current.results
      : answer?.outcome.kind === 'results' && wanted.startsWith(answer.query)
        ? answer.outcome.results.filter((result) => stillMatches(result, wanted))
        : [];

  const note = !searching
    ? null
    : current === null
      ? results.length === 0
        ? 'Searching…'
        : null
      : current.kind === 'limited'
        ? 'That is a lot of searching. Try again in a little while.'
        : current.kind === 'offline'
          ? 'Search needs a connection.'
          : results.length === 0
            ? 'Nobody by that name.'
            : null;

  /*
   * Return opens an exact username even when search could not answer -
   * offline, or out of allowance - which is how this screen worked before
   * search existed, and still the quickest path for somebody reading a
   * username off a friend's phone.
   */
  const submit = () => {
    if (!wanted) return;
    router.push(`/profile/${results.find((result) => result.handle === wanted)?.handle ?? wanted}`);
  };

  return (
    <Section title="Find someone" icon={<FriendsIcon size={15} color={colors.inkFaint} />} first>
      <TextField
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={submit}
        placeholder="Their name or username"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={40}
      />
      {results.length > 0 ? (
        <Panel flush style={styles.results}>
          {results.map((result, index) => (
            <View key={result.handle}>
              {index > 0 ? <Divider inset={space.lg} /> : null}
              <Row
                title={result.handle}
                subtitle={result.displayName ?? undefined}
                value={RELATION[result.relation]}
                onPress={() => router.push(`/profile/${result.handle}`)}
              />
            </View>
          ))}
        </Panel>
      ) : null}
      {note ? (
        <Caption tone="faint" style={styles.note}>
          {note}
        </Caption>
      ) : null}
    </Section>
  );
}

/** Where you already stand, so a result does not have to be opened to find out. */
const RELATION: Record<SearchResult['relation'], string | undefined> = {
  friend: 'Friend',
  requested: 'Request sent',
  incoming: 'Sent you a request',
  none: undefined,
};

function nameOf(friend: Friend): string {
  return friend.displayName || friend.handle || 'Someone';
}

const styles = StyleSheet.create({
  results: { marginTop: space.sm },
  note: { marginTop: space.sm, paddingHorizontal: space.xs },
  answer: { flexDirection: 'row', gap: space.xs },
  empty: { gap: space.sm },
});
