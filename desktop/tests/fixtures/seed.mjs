import { randomUUID } from 'node:crypto';
import demo from './demo.json' with { type: 'json' };
export function seedDemo(store) {
  if (store.records('goal').length) throw new Error('Demo content requires an empty workspace.');
  const board = structuredClone(demo.board), records = [...board.goals, ...board.strategies, ...board.decisions];
  const latest = Math.max(...records.map(record => Date.parse(record.updatedAt))), current = Date.now();
  const rebase = value => new Date(current + Date.parse(value) - latest).toISOString().replace(/\.\d{3}Z$/, 'Z');
  store.transaction(() => {
    for (const [kind, values] of [['goal', board.goals], ['strategy', board.strategies], ['decision', board.decisions]]) {
      for (const record of values) {
        const { outcome, ...value } = record;
        value.createdAt = rebase(value.createdAt); value.updatedAt = rebase(value.updatedAt); store.persist(kind, value);
        if (outcome) {
          outcome.id = randomUUID().toUpperCase(); outcome.decidedAt = rebase(outcome.decidedAt);
          if (outcome.acknowledgedAt) outcome.acknowledgedAt = rebase(outcome.acknowledgedAt);
          if (outcome.withdrawnAt) outcome.withdrawnAt = rebase(outcome.withdrawnAt);
          store.persistOutcome(outcome);
        }
      }
    }
    // The demo's idle strategies have already completed their initial decision research.
    for (const strategy of board.strategies) {
      if (!board.decisions.some(card => card.strategyID === strategy.id && card.status === 'active' && !card.outcome))
        store.query("INSERT INTO metadata(key,value) VALUES(?,'prepared')", `strategy_auto_advance:${strategy.id}`);
    }
  });
}
