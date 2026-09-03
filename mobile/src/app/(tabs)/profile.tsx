import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Body,
  BodyStrong,
  Button,
  Caption,
  CaptionStrong,
  Divider,
  Panel,
  Row,
  Screen,
  Section,
  TextField,
  TileFace,
  Title,
} from '@/design/components';
import { PlayersIcon, SparkIcon, TrophyIcon } from '@/design/icons';
import { colors, space, tileSize } from '@/design/tokens';
import { findRuleSet, useAppState } from '@/store/store';
import { setDisplayName, useAccount } from '@/store/account';
import { isCloudConfigured } from '@/lib/supabase';
import type { TileCode } from '@/tiles/tileset';
import type { HandRecord, Session } from '@/store/types';
import { relativeDate } from '@/lib/format';

/**
 * The profile.
 *
 * It exists from first launch and for everybody, because everybody has an
 * account from first launch - an anonymous one until they choose otherwise.
 * There is nothing to sign up for and nothing gated behind having done so.
 *
 * The name earns its place immediately: it fills seat one of every new
 * session, which is the one piece of setup starting a game could never skip.
 */
export default function ProfileScreen() {
  const sessions = useAppState(useCallback((state) => state.sessions, []));
  const account = useAccount(useCallback((a) => a, []));
  const [draftName, setDraftName] = useState<string | null>(null);

  const best = useMemo(() => bestHand(sessions), [sessions]);
  const handsScored = sessions.reduce((sum, session) => sum + session.hands.length, 0);

  const commitName = () => {
    if (draftName !== null) void setDisplayName(draftName);
    setDraftName(null);
  };

  return (
    <Screen scroll>
      <View style={styles.head}>
        <Title>{account.displayName || 'Your table'}</Title>
        <Caption tone="faint">
          {account.status === 'identified'
            ? (account.email ?? 'Signed in')
            : account.status === 'anonymous'
              ? 'On this device only'
              : 'Offline'}
        </Caption>
      </View>

      <Section title="Your name" icon={<PlayersIcon size={15} color={colors.inkFaint} />} first>
        <TextField
          value={draftName ?? account.displayName ?? ''}
          onChangeText={setDraftName}
          onBlur={commitName}
          onSubmitEditing={commitName}
          placeholder="What people call you"
          maxLength={18}
        />
        <Caption tone="faint" style={styles.note}>
          Fills your seat when you start a session. Hold a seat to change it there.
        </Caption>
      </Section>

      {/*
        * Highest score for now, which is the obvious pick and a bit boring:
        * for anyone who has ever had a limit hand it is that hand forever.
        * Rarity - how uncommon a hand's best pattern is across this player's
        * own history - makes the better story and is the intended default once
        * there is enough history to measure it against.
        */}
      <Section title="Best hand" icon={<TrophyIcon size={15} color={colors.brass} />}>
        {best ? (
          <Panel style={styles.best}>
            <View style={styles.bestTiles}>
              {best.tiles.slice(0, 9).map((code, index) => (
                <TileFace key={`${code}-${index}`} code={code} width={tileSize.sm} />
              ))}
            </View>
            <View style={styles.bestLine}>
              <BodyStrong tone="accent" numeric>
                {best.record.summary.total} {best.record.summary.unit}
              </BodyStrong>
              <Caption tone="faint">{relativeDate(best.record.createdAt)}</Caption>
            </View>
            {best.record.summary.topPatterns.length > 0 ? (
              <Caption tone="muted">{best.record.summary.topPatterns.join(' · ')}</Caption>
            ) : null}
            <Caption tone="faint">{findRuleSet(best.ruleSetId)?.name ?? ''}</Caption>
          </Panel>
        ) : (
          <Panel style={styles.empty}>
            <SparkIcon size={24} color={colors.inkFaint} />
            <Caption tone="faint">Score a hand and it will show up here.</Caption>
          </Panel>
        )}
      </Section>

      <Section title="All time">
        <Panel flush>
          <Row title="Hands scored" value={String(handsScored)} />
          <Divider inset={space.lg} />
          <Row title="Sessions played" value={String(sessions.length)} />
        </Panel>
      </Section>

      <Section title="Account">
        {account.status === 'identified' ? (
          <Panel flush>
            <Row title="Signed in as" value={account.email ?? '—'} />
          </Panel>
        ) : (
          <Panel style={styles.upgrade}>
            <Body tone="muted">
              {isCloudConfigured()
                ? 'Your games are on this device. Sign in to reach them from another one.'
                : 'This build has no account server configured, so everything stays on this device.'}
            </Body>
            {isCloudConfigured() ? (
              <Button label="Sign in" variant="primary" block disabled />
            ) : null}
            {isCloudConfigured() ? (
              <CaptionStrong tone="faint">Coming in the next update</CaptionStrong>
            ) : null}
          </Panel>
        )}
      </Section>
    </Screen>
  );
}

interface BestHand {
  readonly record: HandRecord;
  readonly ruleSetId: string;
  readonly tiles: TileCode[];
}

/** The highest-scoring hand across every session, with its tiles. */
function bestHand(sessions: readonly Session[]): BestHand | null {
  let best: BestHand | null = null;
  for (const session of sessions) {
    for (const record of session.hands) {
      if (best && record.summary.total <= best.record.summary.total) continue;
      best = {
        record,
        ruleSetId: session.ruleSetId,
        tiles: [...(record.hand.exposed ?? []), ...record.hand.concealed],
      };
    }
  }
  return best;
}

const styles = StyleSheet.create({
  head: { paddingTop: space.md, paddingBottom: space.xs, gap: 2 },
  note: { marginTop: space.sm, paddingHorizontal: space.xs },
  best: { gap: space.sm },
  bestTiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  bestLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  upgrade: { gap: space.md, alignItems: 'flex-start' },
});
