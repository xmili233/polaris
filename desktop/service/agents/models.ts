import { PolarisError } from '../model.js';
import type { ModelOption, ModelSettings, NativeModel } from './types.js';

export function codexModel(model: any): NativeModel {
  const options: ModelOption[] = [];
  const efforts = (model.supportedReasoningEfforts ?? []).filter((item: any) => typeof item.reasoningEffort === 'string');
  if (efforts.length) options.push({ id: 'reasoningEffort', kind: 'reasoning', name: 'Reasoning', defaultValue: model.defaultReasoningEffort,
    choices: efforts.map((item: any) => ({ value: item.reasoningEffort, name: item.reasoningEffort })) });
  const tiers = model.serviceTiers?.length ? model.serviceTiers : (model.additionalSpeedTiers ?? []).map((id: string) => ({ id, name: id }));
  if (tiers.length) options.push({ id: 'serviceTier', kind: 'speed', name: 'Service Tier', defaultValue: model.defaultServiceTier ?? 'default',
    choices: [{ value: 'default', name: 'Standard' }, ...tiers.filter((tier: any) => typeof tier.id === 'string' && tier.id !== 'default').map((tier: any) => ({ value: tier.id, name: tier.name ?? tier.id, fast: ['fast', 'priority', 'ultrafast'].includes(tier.id) }))] });
  return { id: model.model ?? model.id, name: model.displayName ?? model.model ?? model.id, isDefault: model.isDefault === true, options };
}

export function acpModelOptions(config: any[]): ModelOption[] {
  return (config ?? []).flatMap((item: any): ModelOption[] => {
    const kind = item.category === 'thought_level' || ['effort', 'reasoningEffort'].includes(item.id) ? 'reasoning'
      : ['fast', 'fastMode', 'serviceTier', 'service_tier', 'speed'].includes(item.id) ? 'speed' : undefined;
    if (!kind || typeof item.id !== 'string') return [];
    const choices = item.type === 'boolean' ? [{ value: false, name: 'Standard' }, { value: true, name: 'Fast', fast: true }]
      : (item.options ?? []).flatMap((entry: any) => entry.options ?? [entry]).filter((entry: any) => typeof entry.value === 'string').map((entry: any) => ({ value: entry.value, name: entry.name ?? entry.value,
        ...(kind === 'speed' ? { fast: ['on', 'fast', 'priority', 'ultrafast'].includes(entry.value) } : {}) }));
    if (!choices.length) return [];
    return [{ id: item.id, kind, name: item.name ?? item.id, ...(typeof item.description === 'string' ? { description: item.description } : {}), choices,
      currentValue: item.currentValue, defaultValue: choices.some((entry: any) => entry.value === 'default') ? 'default' : item.currentValue }];
  });
}

export function validateModelSettings(model: NativeModel | undefined, input: unknown): ModelSettings {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PolarisError('invalid_input', 'Invalid model settings.');
  const result: ModelSettings = {};
  for (const [id, value] of Object.entries(input)) {
    if (!model?.options?.some(option => option.id === id && option.choices.some(choice => choice.value === value)))
      throw new PolarisError('native_models', 'This model option is no longer available.', 'agent.modelOptionsChanged');
    result[id] = value as string | boolean;
  }
  return result;
}
