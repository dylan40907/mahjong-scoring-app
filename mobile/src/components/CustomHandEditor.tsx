import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  Body,
  BodyStrong,
  Button,
  Caption,
  Chip,
  Divider,
  Panel,
  Section,
  Stepper,
  TextField,
  TileFace,
} from '@/design/components';
import { CloseIcon, PlusIcon, TrashIcon } from '@/design/icons';
import { colors, radius, space, tileSize } from '@/design/tokens';
import { TilePicker } from '@/components/TilePicker';
import {
  CUSTOM_HAND_PREFIX,
  describeRequirement,
  type CustomHand,
  type HandRequirement,
  type PairRule,
  type SetKind,
  type SuitRule,
  type TileFamily,
} from '@/scoring';
import { TILE_BY_CODE, type TileCode } from '@/tiles/tileset';

/**
 * Describing a hand your table plays and nobody else does.
 *
 * A requirement at a time, each one a claim about the hand, and the hand
 * scores when all of them hold. That is a smaller language than the built-in
 * detectors, which are arbitrary code - no requirement can look at two things
 * at once - but it is a language that can be edited with steppers, and the
 * alternative for a house rule was "we do not support that".
 *
 * A modal rather than a route because the ruleset it belongs to is unsaved
 * while this is open, and handing a half-built ruleset through a navigation
 * parameter is how drafts get lost.
 */

interface Props {
  visible: boolean;
  /** The hand being edited, or null to start a new one. */
  hand: CustomHand | null;
  onCancel: () => void;
  onSave: (hand: CustomHand) => void;
  onDelete?: () => void;
}

type RequirementKind = HandRequirement['kind'];

const KIND_LABEL: Record<RequirementKind, string> = {
  sets: 'How many sets',
  pairs: 'Made of pairs',
  suits: 'Which suits',
  tiles: 'What every tile is',
  'triplet-of': 'Triplets of particular tiles',
  contains: 'Contains particular tiles',
  'pair-is': 'What the pair is',
  won: 'How it was won',
};

const KIND_ORDER: RequirementKind[] = [
  'sets', 'suits', 'tiles', 'pair-is', 'triplet-of', 'contains', 'pairs', 'won',
];

function blankRequirement(kind: RequirementKind): HandRequirement {
  switch (kind) {
    case 'sets':
      return { kind: 'sets', of: 'pung', atLeast: 3 };
    case 'pairs':
      return { kind: 'pairs', count: 7 };
    case 'suits':
      return { kind: 'suits', rule: 'single-suit' };
    case 'tiles':
      return { kind: 'tiles', family: 'terminal-or-honour', scope: 'every' };
    case 'triplet-of':
      return { kind: 'triplet-of', tiles: [], mode: 'all' };
    case 'contains':
      return { kind: 'contains', tiles: [] };
    case 'pair-is':
      return { kind: 'pair-is', rule: 'dragon' };
    case 'won':
      return { kind: 'won', how: 'self-drawn' };
  }
}

const SET_OPTIONS: { value: SetKind; label: string }[] = [
  { value: 'chow', label: 'Runs' },
  { value: 'pung', label: 'Triplets' },
  { value: 'kong', label: 'Kongs' },
  { value: 'concealed-set', label: 'Concealed' },
  { value: 'set', label: 'Any set' },
];

const SUIT_OPTIONS: { value: SuitRule; label: string }[] = [
  { value: 'single-suit', label: 'One suit only' },
  { value: 'single-suit-plus-honours', label: 'One suit + honours' },
  { value: 'no-honours', label: 'No honours' },
  { value: 'honours-only', label: 'Honours only' },
  { value: 'all-three-suits', label: 'All three suits' },
];

const FAMILY_OPTIONS: { value: TileFamily; label: string }[] = [
  { value: 'terminal-or-honour', label: 'Terminal or honour' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'simple', label: 'Simple' },
  { value: 'honour', label: 'Honour' },
  { value: 'green', label: 'Green' },
];

const PAIR_OPTIONS: { value: PairRule; label: string }[] = [
  { value: 'dragon', label: 'A dragon' },
  { value: 'wind', label: 'A wind' },
  { value: 'seat-wind', label: 'The seat wind' },
  { value: 'round-wind', label: 'The round wind' },
  { value: 'terminal', label: 'A terminal' },
  { value: 'simple', label: 'A simple' },
];

/** A row of chips, used wherever a segmented control would have five options. */
function ChipRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.chips}>
      {options.map((option) => (
        <Chip
          key={option.value}
          label={option.label}
          selected={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  );
}

function RequirementControls({
  requirement,
  onChange,
  onPickTiles,
}: {
  requirement: HandRequirement;
  onChange: (next: HandRequirement) => void;
  onPickTiles: () => void;
}) {
  switch (requirement.kind) {
    case 'sets':
      return (
        <View style={styles.controls}>
          <ChipRow
            options={SET_OPTIONS}
            value={requirement.of}
            onChange={(of) => onChange({ ...requirement, of })}
          />
          <View style={styles.controlRow}>
            <ChipRow
              options={[
                { value: 'at-least', label: 'At least' },
                { value: 'exactly', label: 'Exactly' },
              ]}
              value={requirement.exactly ? 'exactly' : 'at-least'}
              onChange={(mode) => onChange({ ...requirement, exactly: mode === 'exactly' })}
            />
            <Stepper
              value={requirement.atLeast}
              min={0}
              max={8}
              onChange={(atLeast) => onChange({ ...requirement, atLeast })}
            />
          </View>
        </View>
      );

    case 'pairs':
      return (
        <View style={styles.controlRow}>
          <Body tone="muted">Pairs</Body>
          <Stepper
            value={requirement.count}
            min={2}
            max={9}
            onChange={(count) => onChange({ ...requirement, count })}
          />
        </View>
      );

    case 'suits':
      return (
        <ChipRow
          options={SUIT_OPTIONS}
          value={requirement.rule}
          onChange={(rule) => onChange({ ...requirement, rule })}
        />
      );

    case 'tiles':
      return (
        <View style={styles.controls}>
          <ChipRow
            options={[
              { value: 'every', label: 'Every tile is' },
              { value: 'none', label: 'No tile is' },
            ]}
            value={requirement.scope}
            onChange={(scope) => onChange({ ...requirement, scope })}
          />
          <ChipRow
            options={FAMILY_OPTIONS}
            value={requirement.family}
            onChange={(family) => onChange({ ...requirement, family })}
          />
        </View>
      );

    case 'pair-is':
      return (
        <ChipRow
          options={PAIR_OPTIONS}
          value={requirement.rule}
          onChange={(rule) => onChange({ ...requirement, rule })}
        />
      );

    case 'won':
      return (
        <ChipRow
          options={[
            { value: 'self-drawn', label: 'Self-drawn' },
            { value: 'discard', label: 'On a discard' },
          ]}
          value={requirement.how}
          onChange={(how) => onChange({ ...requirement, how })}
        />
      );

    case 'triplet-of':
    case 'contains':
      return (
        <View style={styles.controls}>
          {requirement.kind === 'triplet-of' ? (
            <ChipRow
              options={[
                { value: 'all', label: 'All of these' },
                { value: 'any', label: 'Any of these' },
              ]}
              value={requirement.mode}
              onChange={(mode) => onChange({ ...requirement, mode })}
            />
          ) : null}
          <View style={styles.tileRow}>
            {requirement.tiles.map((code, index) => (
              <TileFace
                key={`${code}-${index}`}
                code={code}
                width={tileSize.sm}
                accessibilityLabel={`Remove ${TILE_BY_CODE[code].label}`}
                onPress={() =>
                  onChange({
                    ...requirement,
                    tiles: requirement.tiles.filter((_tile, i) => i !== index),
                  })
                }
              />
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a tile"
              onPress={onPickTiles}
              style={({ pressed }) => [styles.addTile, pressed && styles.pressed]}
            >
              <PlusIcon size={14} color={colors.inkFaint} />
            </Pressable>
          </View>
          {requirement.tiles.length > 0 ? (
            <Caption tone="faint">Tap a tile to remove it.</Caption>
          ) : null}
        </View>
      );
  }
}

export function CustomHandEditor({ visible, hand, onCancel, onSave, onDelete }: Props) {
  const [name, setName] = useState(hand?.name ?? '');
  const [description, setDescription] = useState(hand?.description ?? '');
  const [requirements, setRequirements] = useState<HandRequirement[]>([
    ...(hand?.requirements ?? []),
  ]);
  const [adding, setAdding] = useState(false);
  /** Which requirement the tile picker is filling, if any. */
  const [picking, setPicking] = useState<number | null>(null);

  /*
   * The modal is remounted per open by the `key` its parent gives it, so the
   * state above is seeded once from `hand` and never has to be synced back.
   * Deriving it in an effect instead is how an editor ends up fighting the
   * keystroke somebody just typed.
   */

  const update = (index: number, next: HandRequirement) =>
    setRequirements((current) => current.map((item, i) => (i === index ? next : item)));

  const addTile = (code: TileCode) => {
    if (picking === null) return;
    const requirement = requirements[picking];
    if (requirement.kind !== 'triplet-of' && requirement.kind !== 'contains') return;
    update(picking, { ...requirement, tiles: [...requirement.tiles, code] });
    setPicking(null);
  };

  const trimmed = name.trim();
  // A hand with no name cannot be found again in the pattern list, and one
  // with no requirements would score on every win; both are refused here
  // rather than saved and silently ignored.
  const problems: string[] = [];
  if (trimmed.length === 0) problems.push('Give the hand a name.');
  if (requirements.length === 0) problems.push('Add at least one requirement.');

  const save = () => {
    if (problems.length > 0) return;
    onSave({
      id: hand?.id ?? `${CUSTOM_HAND_PREFIX}${Date.now().toString(36)}`,
      name: trimmed,
      description: description.trim() || 'A hand this table plays.',
      requirements,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <BodyStrong>{hand ? 'Edit hand' : 'New hand'}</BodyStrong>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onCancel}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <CloseIcon size={20} color={colors.inkMuted} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Section title="Name" first>
              <TextField value={name} onChangeText={setName} placeholder="Nine Gates, Jade Gate…" />
            </Section>

            <Section title="What it is">
              <TextField
                value={description}
                onChangeText={setDescription}
                placeholder="One line, shown on the score screen"
              />
            </Section>

            <Section title="Requirements" note={`${requirements.length}`}>
              {requirements.length === 0 ? (
                <Caption tone="faint" style={styles.empty}>
                  A hand with no requirements never scores. Add what has to be true of it.
                </Caption>
              ) : (
                <Panel flush>
                  {requirements.map((requirement, index) => (
                    <View key={`${requirement.kind}-${index}`}>
                      {index > 0 ? <Divider inset={space.lg} /> : null}
                      <View style={styles.requirement}>
                        <View style={styles.requirementHead}>
                          <Body style={styles.requirementText}>
                            {describeRequirement(requirement)}
                          </Body>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Remove this requirement"
                            onPress={() =>
                              setRequirements((current) =>
                                current.filter((_item, i) => i !== index),
                              )
                            }
                            style={({ pressed }) => pressed && styles.pressed}
                          >
                            <TrashIcon size={16} color={colors.inkFaint} />
                          </Pressable>
                        </View>
                        <RequirementControls
                          requirement={requirement}
                          onChange={(next) => update(index, next)}
                          onPickTiles={() => setPicking(index)}
                        />
                      </View>
                    </View>
                  ))}
                </Panel>
              )}

              {adding ? (
                <View style={styles.kinds}>
                  {KIND_ORDER.map((kind) => (
                    <Chip
                      key={kind}
                      label={KIND_LABEL[kind]}
                      onPress={() => {
                        setRequirements((current) => [...current, blankRequirement(kind)]);
                        setAdding(false);
                      }}
                    />
                  ))}
                  <Button label="Cancel" variant="ghost" onPress={() => setAdding(false)} />
                </View>
              ) : (
                <Button
                  label="Add a requirement"
                  block
                  icon={<PlusIcon size={16} color={colors.ink} />}
                  onPress={() => setAdding(true)}
                  style={styles.addRequirement}
                />
              )}
            </Section>

            {onDelete ? (
              <Section title="Remove">
                <Button label="Delete this hand" variant="ghost" block onPress={onDelete} />
              </Section>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            {problems.length > 0 ? (
              <Caption tone="loss" style={styles.problem}>
                {problems[0]}
              </Caption>
            ) : null}
            <Button
              label="Save Hand"
              variant="primary"
              block
              disabled={problems.length > 0}
              onPress={save}
            />
          </View>
        </View>
      </View>

      <TilePicker
        visible={picking !== null}
        onClose={() => setPicking(null)}
        onSelect={addTile}
        title="Add a tile"
        includeBonus={false}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    flex: 1,
    marginTop: space.giant,
    backgroundColor: colors.ground,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  body: { paddingHorizontal: space.xl, paddingBottom: space.xxxl },
  empty: { paddingHorizontal: space.xs },
  requirement: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm },
  requirementHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  requirementText: { flex: 1 },
  controls: { gap: space.sm },
  controlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.md },
  addRequirement: { marginTop: space.md },
  tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, alignItems: 'center' },
  addTile: {
    width: tileSize.sm,
    height: Math.round(tileSize.sm * (4 / 3)),
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  problem: { marginBottom: space.sm, paddingHorizontal: space.xs },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.xxl,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.ground,
  },
});
