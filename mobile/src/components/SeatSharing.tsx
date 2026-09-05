import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Button,
  Caption,
  CaptionStrong,
  Divider,
  Panel,
  Row,
  Section,
  TileFace,
} from '@/design/components';
import { CheckIcon, FriendsIcon } from '@/design/icons';
import { colors, space } from '@/design/tokens';
import { useAccount } from '@/store/account';
import { acceptedFriends, useFriends, type Friend } from '@/store/friends';
import { linkSeat, unlinkSeat } from '@/store/store';
import { syncNow } from '@/store/sync/engine';
import type { Session } from '@/store/types';

/**
 * Saying which of the four seats are people with the app.
 *
 * This is the whole point of having friends at all. A game is scored on one
 * phone, and without this it only ever exists on that phone - three of the
 * four people played the same night and have nothing to show for it. Naming a
 * seat as a friend puts that game in their history too, with their own totals
 * worked out from their seat, and it stays there.
 *
 * It lives on the session screen rather than in a setup step, because who is
 * at the table is something you find out by sitting down. Somebody arrives
 * late, somebody swaps out after an hour, and the answer changes mid-game -
 * which is why it can be changed mid-game.
 *
 * Every change takes effect immediately and offline. The friend's phone finds
 * out at the next sync on both devices, which in a basement is on the way
 * home, and nothing about scoring the night waits for it.
 */
export function SeatSharing({ session }: { session: Session }) {
  const router = useRouter();
  const friends = useFriends(useCallback((state) => state.friends, []));
  const me = useAccount(useCallback((account) => account.userId, []));
  const [openSeat, setOpenSeat] = useState<string | null>(null);

  const available = acceptedFriends(friends);
  const shared = session.players.filter(
    (player) => player.accountId && player.accountId !== me,
  ).length;

  const nameFor = (accountId: string | undefined) => {
    if (!accountId) return undefined;
    if (accountId === me) return 'You';
    const friend = available.find((f) => f.id === accountId);
    return friend ? label(friend) : 'A friend';
  };

  return (
    <Section
      title="Who's here"
      icon={<FriendsIcon size={15} color={colors.inkFaint} />}
      note={shared > 0 ? `${shared} sharing` : undefined}
    >
      <Panel flush>
        {session.players.map((player, index) => {
          const open = openSeat === player.id;
          return (
            <View key={player.id}>
              {index > 0 ? <Divider inset={space.lg} /> : null}
              <Row
                title={player.name}
                leading={<TileFace code={player.seat} width={20} />}
                value={nameFor(player.accountId)}
                onPress={() => setOpenSeat(open ? null : player.id)}
                chevron={!open}
              />
              {/*
                * Opens in place, like the ruleset picker in settings: this is
                * one tap either side of one decision, and a pushed screen
                * would cost two more for the navigation around it.
                */}
              {open ? (
                <View>
                  {available.length === 0 ? (
                    <View style={styles.none}>
                      <Caption tone="faint">
                        Nobody to add yet. A friend has to accept before they can be put in a game.
                      </Caption>
                      <Button
                        label="Find friends"
                        block
                        onPress={() => {
                          setOpenSeat(null);
                          router.push('/friends');
                        }}
                      />
                    </View>
                  ) : (
                    available.map((friend) => {
                      const here = player.accountId === friend.id;
                      const elsewhere = session.players.find(
                        (other) => other.id !== player.id && other.accountId === friend.id,
                      );
                      return (
                        <View key={friend.id}>
                          <Divider inset={space.lg} />
                          <Row
                            title={label(friend)}
                            // One person, one seat. Saying where they already
                            // are beats letting somebody put them in two
                            // chairs and quietly moving them.
                            subtitle={elsewhere ? `Currently in ${elsewhere.name}'s seat` : undefined}
                            trailing={
                              here ? <CheckIcon size={18} color={colors.melded} /> : undefined
                            }
                            chevron={false}
                            onPress={() => {
                              if (here) unlinkSeat(session.id, player.id);
                              else linkSeat(session.id, player.id, friend.id, label(friend));
                              setOpenSeat(null);
                              void syncNow();
                            }}
                          />
                        </View>
                      );
                    })
                  )}
                </View>
              ) : null}
            </View>
          );
        })}
      </Panel>

      <View style={styles.note}>
        <CaptionStrong tone="muted">
          {shared === 0
            ? 'This game is on this phone only.'
            : `${shared === 1 ? 'One person' : `${shared} people`} will see this game in their own history.`}
        </CaptionStrong>
        <Caption tone="faint">
          {shared === 0
            ? 'Name a seat as a friend and the game reaches them too, with their own running total worked out from that seat.'
            : 'They see the scores and the hands, and nothing else of yours. Take them out and their copy goes with them.'}
        </Caption>
      </View>
    </Section>
  );
}

function label(friend: Friend): string {
  return friend.displayName || friend.handle || 'Someone';
}

const styles = StyleSheet.create({
  none: { padding: space.lg, gap: space.md, borderTopWidth: 1, borderTopColor: colors.line },
  note: { marginTop: space.md, paddingHorizontal: space.xs, gap: 2 },
});
