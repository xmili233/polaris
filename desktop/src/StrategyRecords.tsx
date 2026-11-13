import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DesktopResult } from '../service/desktop-contract';
import { call, outcomeLabel, type Decision } from './types';
import { useLocale } from './LocaleProvider';
import { translator } from './i18n';
import { Markdown } from './Markdown';

type Records = DesktopResult<'strategyRecords'>;
export function StrategyRecords({ strategyID, onClose, onDecision }: { strategyID: string; onClose(): void; onDecision(card: Decision): void }) {
  const { config } = useLocale(), t = translator(config.language), dialog = useRef<HTMLElement>(null);
  const [records, setRecords] = useState<Records>(), [failed, setFailed] = useState(false);
  useEffect(() => { let alive = true; void call('strategyRecords', { strategyID }).then(value => { if (alive) setRecords(value); }, () => { if (alive) setFailed(true); }); return () => { alive = false; }; }, [strategyID]);
  useEffect(() => { dialog.current?.focus({ preventScroll: true }); }, []);
  const close = () => { onClose(); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-strategy-id="${CSS.escape(strategyID)}"]`)?.focus()); };
  const date = (value: string) => new Date(value).toLocaleString(config.language, { dateStyle: 'medium', timeStyle: 'short' });
  return createPortal(<div className="settings-layer" onPointerDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="strategy-records" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="records-title" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],summary')].filter(node => node.getClientRects().length);
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="records-header"><h2 id="records-title">{records?.strategy.title ?? t('strategy.records')}</h2><button aria-label={t('common.close')} onClick={close}>×</button></header>
      {failed && <p role="alert">{t('errors.connection')}</p>}
      {records && <div className="records-body">
        <Markdown source={records.strategy.body} />
        <h3>{t('strategy.decisions')}</h3>
        {records.decisions.map(card => <button className="record-row" key={card.id} onClick={() => onDecision(card)}><strong>{card.title}</strong><span>{date(card.outcome!.decidedAt)}</span><p>{outcomeLabel(card)}</p></button>)}
        {!records.decisions.length && <p className="record-muted">{t('strategy.noDecisions')}</p>}
      </div>}
    </section>
  </div>, document.body);
}
