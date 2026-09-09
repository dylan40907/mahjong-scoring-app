import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  PageHeader,
  Body,
  Button,
  Caption,
  CaptionStrong,
  Divider,
  Field,
  Panel,
  Row,
  Screen,
  Section,
  Segmented,
  Stepper,
  TextField,
  Toggle,
} from '@/design/components';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CoinsIcon,
  FlowerIcon,
  MeldIcon,
  PlusIcon,
  SparkIcon,
  TrophyIcon,
} from '@/design/icons';
import { colors, space } from '@/design/tokens';
import { CustomHandEditor } from '@/components/CustomHandEditor';
import {
  BUILT_IN_RULESETS,
  PATTERN_LIST,
  describeCustomHand,
  type CustomHand,
  type CustomRuleSet,
  type PatternGroup,
  type PatternValue,
  type PayoutConfig,
} from '@/scoring';
import { findRuleSet, makeId, saveCustomRuleSet, useAppState } from '@/store/store';

/**
 * The custom ruleset editor.
 *
 * Rulesets are built by divergence, not from nothing: pick the table you are
 * closest to and change what differs. Nobody invents a scoring system - they
 * inherit one and argue about six values in it.
 *
 * What changed here is the order of those six values. This used to open on a
 * flat list of ninety hand patterns, which is the part of a ruleset almost
 * nobody edits, and buried the parts every table actually disagrees about:
 * whether a flower pays regardless of seat, what an early win is worth, who
 * pays on a discard, whether a hand needs a yaku at all. Those come first now,
 * grouped, and the ninety hand shapes sit behind one expander.
 *
 * The base preset is also chosen *here* rather than only through the link that
 * opened the screen. Arriving with no base silently meant Taiwanese, which was
 * indistinguishable from the picker being broken.
 */

type Expanded = Exclude<PatternGroup, 'situational' | 'bonus' | 'custom'> | null;

const HAND_GROUPS: { group: Exclude<PatternGroup, 'situational' | 'bonus' | 'custom'>; title: string }[] = [
  { group: 'structural', title: 'Shape of the hand' },
  { group: 'honours', title: 'Winds and dragons' },
  { group: 'suits', title: 'Suits and sequences' },
];

/**
 * Somewhere to start when the counting method changes.
 *
 * Switching payout model replaces the whole config rather than merging: the
 * four models share no fields, and a half-migrated payout is one that pays the
 * wrong people. The faan table is the one thing not exposed for editing - it
 * is a dozen thresholds, and Hong Kong's is the only one anybody uses.
 */
const PAYOUT_DEFAULTS: Record<PayoutConfig['model'], PayoutConfig> = {
  tai: {
    model: 'tai',
    base: 30,
    perTai: 10,
    maxTai: 0,
    discardPayer: 'discarder-alone',
    dealerMultiplier: 1,
    dealerTai: 1,
    streakTai: 2,
  },
  faan: {
    model: 'faan',
    minimumFaan: 3,
    table: [
      { faan: 0, points: 1 }, { faan: 1, points: 2 }, { faan: 2, points: 4 },
      { faan: 3, points: 8 }, { faan: 4, points: 16 }, { faan: 5, points: 24 },
      { faan: 6, points: 32 }, { faan: 7, points: 48 }, { faan: 8, points: 64 },
      { faan: 10, points: 96 }, { faan: 13, points: 128 },
    ],
    discardPaysDouble: true,
    nonDiscardersPay: true,
  },
  riichi: { model: 'riichi', kiriageMangan: false, honbaValue: 300 },
  mcr: { model: 'mcr', minimumPoints: 8, basePerPlayer: 8 },
};

export default function RuleEditorScreen() {
  const router = useRouter();
  const { base, id } = useLocalSearchParams<{ base?: string; id?: string }>();
  useAppState(useCallback((state) => state.customRuleSets, []));

  const existing = id ? (findRuleSet(id) as CustomRuleSet | undefined) : undefined;
  const opened = findRuleSet(base ?? '') ?? BUILT_IN_RULESETS[0];
  const seed = existing ?? opened;

  const [baseId, setBaseId] = useState(existing?.derivedFrom ?? opened.id);
  const [name, setName] = useState(existing?.name ?? `${seed.name} (mine)`);
  const [handSize, setHandSize] = useState<13 | 16>(seed.handSize);
  const [flags, setFlags] = useState({
    usesBonusTiles: seed.usesBonusTiles,
    allowSevenPairs: seed.allowSevenPairs,
    allowThirteenOrphans: seed.allowThirteenOrphans,
    requiresYaku: seed.requiresYaku,
  });
  const [payout, setPayout] = useState<PayoutConfig>(seed.payout);
  const [patterns, setPatterns] = useState<Record<string, PatternValue>>({ ...seed.patterns });
  const [customHands, setCustomHands] = useState<CustomHand[]>([...(seed.customHands ?? [])]);

  const [expanded, setExpanded] = useState<Expanded>(null);
  const [showAll, setShowAll] = useState(false);
  /** Open editor: a hand to edit, 'new', or null. */
  const [editingHand, setEditingHand] = useState<CustomHand | 'new' | null>(null);

  const unit = unitAbbrev(payout.model);

  const byGroup = useMemo(() => {
    const map = new Map<PatternGroup, typeof PATTERN_LIST>();
    for (const definition of PATTERN_LIST) {
      const group = definition.group ?? 'structural';
      map.set(group, [...(map.get(group) ?? []), definition]);
    }
    return map;
  }, []);

  const setValue = (patternId: string, next: number) =>
    setPatterns((current) => ({
      ...current,
      [patternId]: { ...(current[patternId] ?? { value: 0 }), value: next },
    }));

  const toggle = (patternId: string) =>
    setPatterns((current) => {
      const copy = { ...current };
      if (copy[patternId]) delete copy[patternId];
      else copy[patternId] = { value: 1 };
      return copy;
    });

  /** Adopt everything from a different preset, keeping only the name. */
  const rebase = (nextId: string) => {
    const next = findRuleSet(nextId);
    if (!next) return;
    setBaseId(nextId);
    setHandSize(next.handSize);
    setFlags({
      usesBonusTiles: next.usesBonusTiles,
      allowSevenPairs: next.allowSevenPairs,
      allowThirteenOrphans: next.allowThirteenOrphans,
      requiresYaku: next.requiresYaku,
    });
    setPayout(next.payout);
    // Hands the player wrote survive a rebase; the values attached to them do
    // not, because they were denominated in the old preset's unit.
    setPatterns({ ...next.patterns });
  };

  const saveHand = (hand: CustomHand) => {
    setCustomHands((current) => {
      const at = current.findIndex((entry) => entry.id === hand.id);
      return at >= 0 ? current.map((entry, i) => (i === at ? hand : entry)) : [...current, hand];
    });
    // A new hand starts switched on at one unit; an edited one keeps its value.
    setPatterns((current) => ({ ...current, [hand.id]: current[hand.id] ?? { value: 1 } }));
    setEditingHand(null);
  };

  const deleteHand = (handId: string) => {
    setCustomHands((current) => current.filter((entry) => entry.id !== handId));
    setPatterns((current) => {
      const copy = { ...current };
      delete copy[handId];
      return copy;
    });
    setEditingHand(null);
  };

  const save = () => {
    const now = new Date().toISOString();
    const from = findRuleSet(baseId) ?? BUILT_IN_RULESETS[0];
    const ruleSet: CustomRuleSet = {
      id: existing?.id ?? makeId('rules'),
      name: name.trim() || 'Custom rules',
      subtitle: `${handSize} tiles · ${unitName(payout.model)}`,
      family: 'custom',
      handSize,
      ...flags,
      patterns,
      customHands,
      payout,
      builtIn: false,
      derivedFrom: baseId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      notes: `Started from ${from.name} and adjusted.`,
    };
    saveCustomRuleSet(ruleSet);
    router.back();
  };

  const activeCount = Object.keys(patterns).length;

  const patternRows = (group: PatternGroup) => {
    const list = (byGroup.get(group) ?? []).map((definition) => ({
      definition,
      value: patterns[definition.id],
    }));
    return showAll ? list : list.filter((row) => row.value !== undefined);
  };

  const renderPatterns = (group: PatternGroup) => {
    const rows = patternRows(group);
    if (rows.length === 0) {
      return (
        <Caption tone="faint" style={styles.emptyGroup}>
          Nothing from this group is in use. Switch to Everything to add some.
        </Caption>
      );
    }
    return (
      <Panel flush style={styles.patternList}>
        {rows.map((row, index) => {
          const enabled = row.value !== undefined;
          const isLimit = row.value?.limit !== undefined;
          return (
            <View key={row.definition.id}>
              {index > 0 ? <Divider inset={space.lg} /> : null}
              <View style={styles.pattern}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: enabled }}
                  onPress={() => toggle(row.definition.id)}
                  style={styles.patternBody}
                >
                  <Body tone={enabled ? 'default' : 'faint'}>{row.definition.name}</Body>
                  <Caption tone="faint">{row.definition.description}</Caption>
                </Pressable>
                {enabled ? (
                  isLimit ? (
                    <CaptionStrong tone="accent">Limit</CaptionStrong>
                  ) : (
                    <View style={styles.stepperWrap}>
                      <Stepper
                        value={row.value!.value}
                        min={0}
                        max={200}
                        onChange={(next) => setValue(row.definition.id, next)}
                      />
                      <Caption tone="faint">{unit}</Caption>
                    </View>
                  )
                ) : (
                  <Caption tone="faint">Off</Caption>
                )}
              </View>
            </View>
          );
        })}
      </Panel>
    );
  };

  return (
    <Screen
      padded={false}
      header={<PageHeader title={existing ? 'Edit Ruleset' : 'New Ruleset'} />}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Section title="Name" first>
          <TextField value={name} onChangeText={setName} placeholder="My table's rules" />
        </Section>

        {/*
          * Choosing the base is a real control now.
          *
          * It used to be decided entirely by the link that opened this screen,
          * so arriving from "New Ruleset" silently meant Taiwanese with no way
          * to say otherwise - which is indistinguishable from a broken picker.
          */}
        <Section title="Start from" icon={<SparkIcon size={15} color={colors.inkFaint} />}>
          <Panel flush>
            {BUILT_IN_RULESETS.map((preset, index) => (
              <View key={preset.id}>
                {index > 0 ? <Divider inset={space.lg} /> : null}
                <Row
                  title={preset.name}
                  subtitle={preset.subtitle}
                  onPress={() => rebase(preset.id)}
                  trailing={
                    preset.id === baseId ? (
                      <CheckIcon size={18} color={colors.brass} />
                    ) : undefined
                  }
                  chevron={false}
                />
              </View>
            ))}
          </Panel>
          <Caption tone="faint" style={styles.note}>
            Pick this first — it replaces everything below.
          </Caption>
        </Section>

        <Section title="The table" icon={<MeldIcon size={15} color={colors.inkFaint} />}>
          <Panel flush>
            <Field
              title="Hand size"
              subtitle="Sixteen for Taiwanese, thirteen everywhere else."
            >
              <Segmented
                options={[
                  { value: '13', label: '13' },
                  { value: '16', label: '16' },
                ]}
                value={String(handSize)}
                onChange={(next) => setHandSize(next === '16' ? 16 : 13)}
              />
            </Field>
            <Divider inset={space.lg} />
            <Toggle
              label="Flowers and seasons in play"
              hint="Off for Riichi, which has no bonus tiles."
              value={flags.usesBonusTiles}
              onChange={(usesBonusTiles) => setFlags({ ...flags, usesBonusTiles })}
            />
            <Divider inset={space.lg} />
            <Toggle
              label="Seven pairs can win"
              hint="Seven pairs, or seven pairs and a triplet at sixteen tiles."
              value={flags.allowSevenPairs}
              onChange={(allowSevenPairs) => setFlags({ ...flags, allowSevenPairs })}
            />
            <Divider inset={space.lg} />
            <Toggle
              label="Thirteen orphans can win"
              hint="The one hand made of terminals and honours alone."
              value={flags.allowThirteenOrphans}
              onChange={(allowThirteenOrphans) => setFlags({ ...flags, allowThirteenOrphans })}
            />
            <Divider inset={space.lg} />
            <Toggle
              label="A hand needs a scoring pattern"
              hint="Riichi's defining rule: a complete hand with no yaku cannot be declared."
              value={flags.requiresYaku}
              onChange={(requiresYaku) => setFlags({ ...flags, requiresYaku })}
            />
          </Panel>
        </Section>

        <Section title="Counting and payment" icon={<CoinsIcon size={15} color={colors.inkFaint} />}>
          <Segmented
            options={[
              { value: 'tai', label: 'Tai' },
              { value: 'faan', label: 'Faan' },
              { value: 'riichi', label: 'Han' },
              { value: 'mcr', label: 'Points' },
            ]}
            value={payout.model}
            onChange={(model) => setPayout(PAYOUT_DEFAULTS[model as PayoutConfig['model']])}
            style={styles.filter}
          />
          <PayoutFields payout={payout} onChange={setPayout} />
        </Section>

        <Section
          title="How it was won"
          icon={<TrophyIcon size={15} color={colors.inkFaint} />}
          note={`${patternRows('situational').length}`}
        >
          <Caption tone="faint" style={styles.groupNote}>
            Self-draw, concealment, the wait, the last tile, an early win. The part of a ruleset
            that differs most from table to table.
          </Caption>
          {renderPatterns('situational')}
        </Section>

        {flags.usesBonusTiles ? (
          <Section title="Flowers and seasons" icon={<FlowerIcon size={15} color={colors.inkFaint} />}>
            <Caption tone="faint" style={styles.groupNote}>
              Whether a flower pays flat or only when it matches your seat, and what a full set is
              worth.
            </Caption>
            {renderPatterns('bonus')}
          </Section>
        ) : null}

        <Section
          title="Hands you made up"
          icon={<PlusIcon size={15} color={colors.inkFaint} />}
          note={customHands.length > 0 ? `${customHands.length}` : undefined}
        >
          {customHands.length > 0 ? (
            <Panel flush>
              {customHands.map((custom, index) => (
                <View key={custom.id}>
                  {index > 0 ? <Divider inset={space.lg} /> : null}
                  <View style={styles.pattern}>
                    <Pressable onPress={() => setEditingHand(custom)} style={styles.patternBody}>
                      <Body>{custom.name}</Body>
                      <Caption tone="faint">{describeCustomHand(custom)}</Caption>
                    </Pressable>
                    <View style={styles.stepperWrap}>
                      <Stepper
                        value={patterns[custom.id]?.value ?? 0}
                        min={0}
                        max={200}
                        onChange={(next) => setValue(custom.id, next)}
                      />
                      <Caption tone="faint">{unit}</Caption>
                    </View>
                  </View>
                </View>
              ))}
            </Panel>
          ) : (
            <Caption tone="faint" style={styles.emptyGroup}>
              Every group has a hand nobody else plays. Describe yours and the scorer will look for
              it.
            </Caption>
          )}
          <Button
            label="New hand"
            block
            icon={<PlusIcon size={16} color={colors.ink} />}
            onPress={() => setEditingHand('new')}
            style={styles.addHand}
          />
        </Section>

        {/*
          * Ninety hand shapes, behind one tap.
          *
          * They are the least-edited part of a ruleset and were the first thing
          * this screen showed, which made it feel like a spreadsheet and buried
          * everything above.
          */}
        <Section title="Special hands" note={`${activeCount} patterns in use`}>
          <Segmented
            options={[
              { value: 'used', label: 'In use' },
              { value: 'all', label: 'Everything' },
            ]}
            value={showAll ? 'all' : 'used'}
            onChange={(next) => setShowAll(next === 'all')}
            style={styles.filter}
          />
          <Panel flush>
            {HAND_GROUPS.map((entry, index) => (
              <View key={entry.group}>
                {index > 0 ? <Divider inset={space.lg} /> : null}
                <Row
                  title={entry.title}
                  value={`${patternRows(entry.group).length}`}
                  onPress={() => setExpanded(expanded === entry.group ? null : entry.group)}
                  trailing={
                    expanded === entry.group ? (
                      <ChevronDownIcon size={18} color={colors.inkFaint} />
                    ) : (
                      <ChevronRightIcon size={18} color={colors.inkFaint} />
                    )
                  }
                />
              </View>
            ))}
          </Panel>
          {expanded ? <View style={styles.expanded}>{renderPatterns(expanded)}</View> : null}
        </Section>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="Save Ruleset"
          variant="primary"
          block
          icon={<CheckIcon size={18} color={colors.onBrass} />}
          onPress={save}
        />
      </View>

      {editingHand ? (
        <CustomHandEditor
          // Remounted per open, so the editor seeds its fields once and never
          // has to sync them back against the hand being edited.
          key={editingHand === 'new' ? 'new' : editingHand.id}
          visible
          hand={editingHand === 'new' ? null : editingHand}
          onCancel={() => setEditingHand(null)}
          onSave={saveHand}
          onDelete={
            editingHand === 'new' ? undefined : () => deleteHand((editingHand as CustomHand).id)
          }
        />
      ) : null}
    </Screen>
  );
}

/** The numbers that belong to one payout model and to no other. */
function PayoutFields({
  payout,
  onChange,
}: {
  payout: PayoutConfig;
  onChange: (next: PayoutConfig) => void;
}) {
  if (payout.model === 'tai') {
    return (
      <Panel flush>
        <Row
          title="Base (底)"
          subtitle="Paid on any win, before tai."
          trailing={<Stepper value={payout.base} min={0} max={500} step={5} onChange={(base) => onChange({ ...payout, base })} />}
        />
        <Divider inset={space.lg} />
        <Row
          title="Per tai (台)"
          subtitle="What one tai is worth."
          trailing={<Stepper value={payout.perTai} min={1} max={200} step={5} onChange={(perTai) => onChange({ ...payout, perTai })} />}
        />
        <Divider inset={space.lg} />
        <Row
          title="Cap"
          subtitle="Most tai a hand can score. Zero is uncapped."
          trailing={<Stepper value={payout.maxTai} min={0} max={100} step={5} onChange={(maxTai) => onChange({ ...payout, maxTai })} />}
        />
        <Divider inset={space.lg} />
        <Field
          title="On a discard"
          subtitle="Taiwanese tables usually make the discarder pay it all."
        >
          <Segmented
            options={[
              { value: 'discarder-alone', label: 'Discarder' },
              { value: 'everyone', label: 'Everyone' },
            ]}
            value={payout.discardPayer}
            onChange={(next) => onChange({ ...payout, discardPayer: next as 'discarder-alone' | 'everyone' })}
          />
        </Field>
        <Divider inset={space.lg} />
        <Row
          title="Dealer's own tai"
          subtitle="Extra tai the dealer's winning hand is worth."
          trailing={<Stepper value={payout.dealerTai} min={0} max={10} onChange={(dealerTai) => onChange({ ...payout, dealerTai })} />}
        />
        <Divider inset={space.lg} />
        <Row
          title="Tai per dealer repeat"
          subtitle="Added for each hand the dealer has already held. Most tables play two, which the dealer also pays when they lose."
          trailing={<Stepper value={payout.streakTai} min={0} max={10} onChange={(streakTai) => onChange({ ...payout, streakTai })} />}
        />
        <Divider inset={space.lg} />
        <Row
          title="Dealer multiplier"
          subtitle="Dealer wins and losses multiplied by this. One disables it."
          trailing={<Stepper value={payout.dealerMultiplier} min={1} max={4} onChange={(dealerMultiplier) => onChange({ ...payout, dealerMultiplier })} />}
        />
      </Panel>
    );
  }

  if (payout.model === 'faan') {
    return (
      <Panel flush>
        <Row
          title="Minimum faan"
          subtitle="Below this a hand cannot be declared."
          trailing={<Stepper value={payout.minimumFaan} min={0} max={10} onChange={(minimumFaan) => onChange({ ...payout, minimumFaan })} />}
        />
        <Divider inset={space.lg} />
        <Toggle
          label="Discarder pays double"
          hint="The player who fed the hand pays twice the base."
          value={payout.discardPaysDouble}
          onChange={(discardPaysDouble) => onChange({ ...payout, discardPaysDouble })}
        />
        <Divider inset={space.lg} />
        <Toggle
          label="Everyone else still pays"
          hint="Off means only the discarder pays."
          value={payout.nonDiscardersPay}
          onChange={(nonDiscardersPay) => onChange({ ...payout, nonDiscardersPay })}
        />
      </Panel>
    );
  }

  if (payout.model === 'riichi') {
    return (
      <Panel flush>
        <Toggle
          label="Round up to mangan"
          hint="A common house rule for 4 han 30 fu and 3 han 60 fu."
          value={payout.kiriageMangan}
          onChange={(kiriageMangan) => onChange({ ...payout, kiriageMangan })}
        />
        <Divider inset={space.lg} />
        <Row
          title="Per counter stick"
          subtitle="Added for each honba on the table."
          trailing={<Stepper value={payout.honbaValue} min={0} max={1000} step={100} onChange={(honbaValue) => onChange({ ...payout, honbaValue })} />}
        />
      </Panel>
    );
  }

  return (
    <Panel flush>
      <Row
        title="Minimum points"
        subtitle="Flowers excluded, as the Chinese Official rules require."
        trailing={<Stepper value={payout.minimumPoints} min={0} max={40} onChange={(minimumPoints) => onChange({ ...payout, minimumPoints })} />}
      />
      <Divider inset={space.lg} />
      <Row
        title="Base per player"
        subtitle="Everyone pays this on any win, on top of the hand."
        trailing={<Stepper value={payout.basePerPlayer} min={0} max={40} onChange={(basePerPlayer) => onChange({ ...payout, basePerPlayer })} />}
      />
    </Panel>
  );
}

function unitName(model: string): string {
  switch (model) {
    case 'tai':
      return 'counted in tai';
    case 'faan':
      return 'counted in faan';
    case 'riichi':
      return 'han and fu';
    default:
      return 'counted in points';
  }
}

function unitAbbrev(model: string): string {
  return model === 'riichi' ? 'han' : model === 'tai' ? 'tai' : model === 'faan' ? 'faan' : 'pts';
}

const styles = StyleSheet.create({
  // Clears the fixed action bar so the last row can be scrolled into view.
  content: { paddingHorizontal: space.xl, paddingBottom: 96 },
  note: { marginTop: space.sm, paddingHorizontal: space.xs },
  groupNote: { marginBottom: space.md, paddingHorizontal: space.xs },
  emptyGroup: { paddingHorizontal: space.xs },
  filter: { marginBottom: space.md },
  patternList: { paddingVertical: 0 },
  expanded: { marginTop: space.md },
  addHand: { marginTop: space.md },
  pattern: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  patternBody: { flex: 1, gap: 1 },
  stepperWrap: { alignItems: 'center', gap: 2 },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    /*
     * No rule and no fill. A hairline with an opaque band under it read as the
     * page being cut off rather than as an action bar, and once the ground
     * gained a wash the flat `ground` fill became a visible patch sitting on
     * top of it. The button is a brass slab; it does not need a box drawn
     * round it to be found.
     */
  },
});
