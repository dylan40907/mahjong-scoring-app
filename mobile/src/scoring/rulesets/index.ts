import { HONG_KONG_RULESETS } from './hongkong';
import { MCR_RULESETS } from './mcr';
import { RIICHI_RULESETS } from './riichi';
import { TAIWANESE_RULESETS } from './taiwanese';
import type { RuleSet } from './types';

export * from './types';
export { TAIWANESE_COMMON, TAIWANESE_REFERENCE } from './taiwanese';
export { HONG_KONG_OLD_STYLE, HONG_KONG_THREE_FAAN } from './hongkong';
export { RIICHI } from './riichi';
export { CHINESE_OFFICIAL } from './mcr';

/** Presets in the order they are offered, most likely first. */
export const BUILT_IN_RULESETS: readonly RuleSet[] = [
  ...TAIWANESE_RULESETS,
  ...HONG_KONG_RULESETS,
  ...RIICHI_RULESETS,
  ...MCR_RULESETS,
];

export function ruleSetById(id: string): RuleSet | undefined {
  return BUILT_IN_RULESETS.find((r) => r.id === id);
}

export const DEFAULT_RULESET_ID = 'taiwanese-common';
