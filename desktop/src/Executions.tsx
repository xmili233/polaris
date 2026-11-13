import type { translator, MessageKey } from './i18n';
import type { Executions as ExecutionStore } from '../service/execution';

export type TaskResult = ReturnType<ExecutionStore['results']>[number];
export const resultLine = (result: Pick<TaskResult, 'status'>, t: ReturnType<typeof translator>) =>
  t(`execution.status.${result.status}` as MessageKey);
