/** Derived board state, not a separate execution lifecycle. */
export interface LoopState { state: 'cards' | 'running' | 'queued' | 'waiting_connection' | 'waiting_input' | 'scheduled' | 'stalled' | 'needs_review'; title?: string; until?: string; reason?: string; workID?: string; decisionPreparation?: 'queued' | 'running' | 'waiting_connection' }
