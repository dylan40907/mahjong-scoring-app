import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
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
import { CheckIcon, FriendsIcon, PlayersIcon } from '@/design/icons';
import { colors, space } from '@/design/tokens';
import {
  acceptFriend,
  acceptedFriends,
  blockUser,
  incomingRequests,
  outgoingRequests,
  removeFriend,
  requestFriend,
  useFriends,
  type Friend,
} from '@/store/friends';
import { useAccount } from '@/store/account';
import { syncNow } from '@/store/sync/engine';
import { isCloudConfigured } from '@/lib/supabase';

/**
 * Friends.
 *
 * The whole point of the list is the two things it makes possible: seating
 * somebody at tonight's table so the game lands in their history too, and
 * seeing the games they seated you in. Everything here exists to serve those,
 * which is why there is no feed, no activity, and nothing to scroll.
 *
 * People are found by handle. Not by email address - that is a fact about
 * somebody this app has no business being a directory of - and not by
 * browsing, because a list of everyone who uses the app is not a feature, it
 * is a leak. A handle is the thing you can read off a phone across a table.
 *
 * Every action takes effect here and now and is sent later. Mahjong is played
 * in basements, and "add Wei to this game" has to work in one.
 */
export default function FriendsScreen() {
  const friends = useFriends(useCallback((state) => state.friends, []));
  const handle = useAccount(useCallback((account) => account.handle, []));
  const [lookup, setLookup] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const accepted = acceptedFriends(friends);
  const incoming = incomingRequests(friends);
  const outgoing = outgoingRequests(friends);

  const add = () => {
    const wanted = lookup.trim().toLowerCase();
    if (!wanted) return;
    requestFriend(wanted);
    setLookup('');
    // Said before anything has been sent, because nothing has: the request is
    // on this device and will leave when there is a signal. Promising that it
    // arrived would be the lie.
    setNote(`Asked for ${wanted}. They will see it when you are both online.`);
    void syncNow();
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

  /**
   * What a friend's row does when tapped.
   *
   * A row of red Remove buttons was the first version and it was wrong twice
   * over: three destructive controls sitting permanently on a list is a
   * mistap waiting to happen, and it made the loudest thing on the screen the
   * one action nobody opens this screen to take. It also left blocking with
   * nowhere to live.
   */
  const openFriend = (friend: Friend) => {
    Alert.alert(nameOf(friend), friend.handle ?? undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () => {
          // Quieter than removing: they see a friendship that is simply not
          // there, rather than a notice that they were blocked.
          blockUser(friend.id);
          void syncNow();
        },
      },
      { text: 'Remove friend', style: 'destructive', onPress: () => confirmRemove(friend) },
    ]);
  };

  if (!isCloudConfigured()) {
    return (
      <Screen>
        <EmptyState
          icon={<FriendsIcon size={28} color={colors.inkFaint} />}
          title="No account server"
          body="This build cannot reach one, so there is nobody to add."
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Section title="Add someone" icon={<FriendsIcon size={15} color={colors.inkFaint} />} first>
        <Panel style={styles.add}>
          <TextField
            value={lookup}
            onChangeText={setLookup}
            onSubmitEditing={add}
            placeholder="Their name, e.g. wei_88"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
          />
          <Button label="Ask to be friends" block disabled={!lookup.trim()} onPress={add} />
          {note ? <Caption tone="muted">{note}</Caption> : null}
          <Caption tone="faint">
            {handle
              ? `Yours is ${handle}. Read it out and they can find you the same way.`
              : 'Pick a name of your own on the You tab so people can find you back.'}
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

      <Section title="Friends" icon={<PlayersIcon size={15} color={colors.inkFaint} />}>
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
