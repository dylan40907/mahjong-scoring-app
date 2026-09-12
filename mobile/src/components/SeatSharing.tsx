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
import { mySeat } from '@/store/stats';
import { leaveSeat, linkSeat, takeSeat, unlinkSeat } from '@/store/store';
import { syncNow } from '@/store/sync/engine';
import { WIND_LABEL } from '@/lib/format';
import type { Session, SessionPlayer } from '@/store/types';

/**
 * Saying who was in each of the four seats.
 *
 * Two different questions share this list. Which seat is *you* is what lets
 * the profile count wins rather than hands, and it has to be answerable for
 * every game - including the ones scored before there was an account, where
 * all four seats are still "Player 1" to "Player 4", and the ones scored for a
 * table you were not sitting at, where the app's guess that seat one is you is
 * simply wrong. Which seats are *friends* is what puts the game in their
 * history too, with their own totals worked out from their seat.
 *
 * So every seat opens onto the same short list: you, each of your friends,
 * and a guest - a name on the seat and no account behind it, which is what
 * every seat is until somebody says otherwise. It is a choice of one, and
 * whatever is picked
 * replaces what was there - that is what makes taking yourself out of a game
 * the same gesture as putting yourself in one.
 *
 * It lives on the session screen rather than in a setup step, because who is
 * at the table is something you find out by sitting down. Somebody arrives
 * late, somebody swaps out after an hour, and the answer changes mid-game.
 *
 * Every change takes effect immediately and offline. The friend's phone finds
 * out at the next sync on both devices, which in a basement is on the way
 * home, and nothing about scoring the night waits for it.
 */
export function SeatSharing({ session }: { session: Session }) {
  const router = useRouter();
  const friends = useFriends(useCallback((state) => state.friends, []));
  const me = useAccount(useCallback((account) => account.userId, []));
  const myName = useAccount(useCallback((account) => account.displayName, []));
  const [openSeat, setOpenSeat] = useState<string | null>(null);

  const available = acceptedFriends(friends);
  const shared = session.players.filter(
    (player) => player.accountId && player.accountId !== me,
  ).length;
  // The same answer the profile uses, name fallback included, so this list
  // and the totals on the profile can never disagree about which seat is us.
  const mine = mySeat(session, { userId: me, displayName: myName });

  const whoIs = (player: SessionPlayer) => {
    if (player.id === mine?.id) return 'You';
    if (!player.accountId) return undefined;
    const friend = available.find((f) => f.id === player.accountId);
    return friend ? label(friend) : 'A friend';
  };

  const choose = (change: () => void) => {
    change();
    setOpenSeat(null);
    void syncNow();
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
          const isMe = player.id === mine?.id;
          const isNobody = !isMe && !player.accountId;
          return (
            <View key={player.id}>
              {index > 0 ? <Divider inset={space.lg} /> : null}
              <Row
                title={player.name}
                leading={<TileFace code={player.seat} width={20} />}
                value={whoIs(player)}
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
                  {me ? (
                    <>
                      <Divider inset={space.lg} />
                      <Row
                        title="You"
                        subtitle={
                          mine && !isMe ? `Currently in the ${WIND_LABEL[mine.seat]} seat` : undefined
                        }
                        trailing={isMe ? <CheckIcon size={18} color={colors.melded} /> : undefined}
                        chevron={false}
                        onPress={() => choose(() => (isMe ? undefined : takeSeat(session.id, player.id)))}
                      />
                    </>
                  ) : null}

                  {available.map((friend) => {
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
                          // are beats letting somebody put them in two chairs
                          // and quietly moving them.
                          subtitle={
                            elsewhere ? `Currently in the ${WIND_LABEL[elsewhere.seat]} seat` : undefined
                          }
                          trailing={here ? <CheckIcon size={18} color={colors.melded} /> : undefined}
                          chevron={false}
                          onPress={() =>
                            choose(() =>
                              here ? undefined : linkSeat(session.id, player.id, friend.id, label(friend)),
                            )
                          }
                        />
                      </View>
                    );
                  })}

                  <Divider inset={space.lg} />
                  <Row
                    title="Guest"
                    subtitle={
                      isMe
                        ? 'Takes you out of this game'
                        : player.accountId
                          ? 'They stop seeing this game'
                          : 'Just a name, not linked to anyone'
                    }
                    trailing={isNobody ? <CheckIcon size={18} color={colors.melded} /> : undefined}
                    chevron={false}
                    onPress={() =>
                      choose(() => {
                        if (isMe) leaveSeat(session.id, player.id);
                        else if (player.accountId) unlinkSeat(session.id, player.id);
                      })
                    }
                  />

                  {available.length === 0 ? (
                    <View style={styles.none}>
                      <Caption tone="faint">
                        Friends you add show up here too, so a game can land in their history as
                        well as yours.
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
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </Panel>

      <View style={styles.note}>
        <CaptionStrong tone="muted">
          {shared === 0
            ? 'Only you can see this game.'
            : `${shared === 1 ? 'One friend can' : `${shared} friends can`} see this game too.`}
        </CaptionStrong>
        <Caption tone="faint">
          {shared === 0
            ? 'Tap a seat to say who sat there, including which one was you. Friends you add get this game in their own history.'
            : 'They can see this game and nothing else of yours. Remove them and it goes from their phone too.'}
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
