export type Kind = 'goal' | 'strategy' | 'decision';
export type Status = 'active' | 'archived' | 'cancelled';
export interface RecordBase { id: string; version: number; status: Status; createdAt: string; updatedAt: string }
export interface Goal extends RecordBase { title: string; milestone: string; symbol: string; constraints: string }
export interface Strategy extends RecordBase { goalID: string; title: string; body: string; origin: string }
export interface Option { id: string; label: string; detail?: string }
export interface Decision extends RecordBase {
  strategyID: string; title: string; body: string; excerpt?: string;
  inputs?: import('./execution-inputs.js').ExecutionInputs;
  options: Option[]; recommendedOptionID?: string; outcome?: Outcome;
}
export interface Outcome { id: string; decisionID: string; decisionVersion: number; optionID?: string; note: string; decidedAt: string; withdrawnAt?: string; acknowledgedAt?: string }
export interface Board { goals: Goal[]; strategies: Strategy[]; decisions: Decision[] }
export interface Records { goal: Goal; strategy: Strategy; decision: Decision }
export type Entity = Records[Kind];
export class PolarisError extends Error {
  constructor(public code: string, message: string, public messageKey?: string, public params?: Record<string, string | number>) { super(message); }
}
export const kinds: Kind[] = ['goal', 'strategy', 'decision'];
export const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export function encode(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const length = (value: string) => [...segmenter.segment(value)].length;
export function requireText(value: string, field: string, max = 20000) {
  if (!value.trim() || length(value) > max) throw new PolarisError('invalid_input', `${field} is required and must contain at most ${max} characters.`, 'errors.fieldLength', { field, max });
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PolarisError('invalid_input', 'Input must be a JSON object.');
  return value as Record<string, unknown>;
}
export function string(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new PolarisError('invalid_input', 'Invalid field type.');
  return value;
}

export const decisionPreview = (body: string) => body.trim().split(/\n\s*\n/)[0].replace(/\s+/g, ' ').slice(0, 240);
