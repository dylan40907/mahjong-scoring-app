import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Body,
  BodyStrong,
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
  acceptFriend,
  acceptedFriends,
  blockUser,
  incomingRequests,
  outgoingRequests,
  removeFriend,
  useFriends,
  type Friend,
} from '@/store/friends';
import { useAccount } from '@/store/account';
import { syncNow } from '@/store/sync/engine';
import { isCloudConfigured } from '@/lib/supabase';

/**
 * Friends.
 *
 * A tab rather than a section of the profile, because it is a place you go
 * rather than a setting you change: looking somebody up, answering a request,
 * opening a profile. As a panel on the profile screen it was one row deep and gave
 * no hint that any of that existed.
 *
 * People are found by exact username. Not by email address - that is a fact
 * about somebody this app has no business being a directory of - and not by
 * browsing, because a list of everyone who uses the app is not a feature. The
 * lookup goes through a function on the server for the same reason: a read
 * policy saying "public profiles are readable" is also one saying every user
 * can be downloaded at once.
 */
export default function FriendsScreen() {
  const router = useRouter();
  const friends = useFriends(useCallback((state) => state.friends, []));
  const status = useAccount(useCallback((account) => account.status, []));
  const [lookup, setLookup] = useState('');

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
   * Not a lookup field that fails after you type a name into it: a friend list
   * needs an account at both ends, and the honest version says so before the
   * typing rather than after.
   */
  if (status !== 'identified') {
    return (
      <Screen motif="wall">
        <EmptyState
          icon={<FriendsIcon size={28} color={colors.inkFaint} />}
          title="Friends need an account"
          body="Both ends of a friendship have to be somewhere. Make an account on the Profile tab and you can add people, put them in a game, and see the games they put you in."
          action={
            <Button
              label="Go to You"
              variant="primary"
              onPress={() => router.push('/(tabs)/profile')}
            />
          }
        />
      </Screen>
    );
  }

  const search = () => {
    const wanted = lookup.trim().toLowerCase();
    if (!wanted) return;
    setLookup('');
    router.push(`/profile/${wanted}`);
  };

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
      <Section title="Find someone" icon={<FriendsIcon size={15} color={colors.inkFaint} />} first>
        <Panel style={styles.add}>
          <TextField
            value={lookup}
            onChangeText={setLookup}
            onSubmitEditing={search}
            placeholder="Their username, e.g. wei_88"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
          />
          <Button label="Look up" block disabled={!lookup.trim()} onPress={search} />
          <Caption tone="faint">
            Usernames only. Open their profile to send a request.
          </Caption>
        </Panel>
      </Section>

      {incoming.length > 0 ? (
        <Section title="Waiting on you" note={String(incoming.length)}>
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
                        label="Yes"
                        variant="primary"
                        onPress={() => {
                          acceptFriend(friend.id);
                          void syncNow();
                        }}
                      />
                      <Button label="No" onPress={() => confirmRemove(friend)} />
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
            <Caption tone="faint">
              Add someone and you can put them in a game. It lands in their history as well as
              yours, with their own totals worked out from their seat.
            </Caption>
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
        <Section title="Asked, no answer yet">
          <Panel flush>
            {outgoing.map((friend, index) => (
              <View key={friend.id}>
                {index > 0 ? <Divider inset={space.lg} /> : null}
                <Row
                  title={nameOf(friend)}
                  subtitle={friend.local ? 'On this device until you are online' : undefined}
                  trailing={
                    <Button
                      label="Take back"
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

      <Section title="What this shares">
        <Panel style={styles.explain}>
          <BodyStrong>Nothing, until you put someone in a game.</BodyStrong>
          <Caption tone="muted">
            Being friends on its own shares no scores. A game reaches a friend only when you seat
            them at that particular table, one game at a time, and taking them back out takes their
            copy with it.
          </Caption>
        </Panel>
      </Section>
    </Screen>
  );
}

function nameOf(friend: Friend): string {
  return friend.displayName || friend.handle || 'Someone';
}

const styles = StyleSheet.create({
  add: { gap: space.md },
  answer: { flexDirection: 'row', gap: space.xs },
  empty: { gap: space.sm },
  explain: { gap: space.sm },
});
