import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DropdownMenu } from 'radix-ui';
import { Markdown } from './Markdown';
import { useLocale } from './LocaleProvider';
import { translator } from './i18n';
import { dimension } from './theme';

const label = (text: string) => text.split('\n')[0].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`#~]/g, '').trim();

export function GoalConstraints({ text }: { text: string }) {
  const { config } = useLocale(), t = translator(config.language);
  const sections = useMemo(() => text.trim().split(/\n\s*\n/).filter(Boolean), [text]);
  const row = useRef<HTMLDivElement>(null), measure = useRef<HTMLDivElement>(null);
  const origin = useRef<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(sections.length);
  const [selected, setSelected] = useState<number | null>(null);
  const current = selected === null ? undefined : sections[selected];
  const show = (index: number) => { origin.current = index; setSelected(index); };

  useEffect(() => { if (selected !== null && current === undefined) setSelected(null); }, [selected, current]);

  useLayoutEffect(() => {
    const element = row.current, samples = measure.current;
    if (!element || !samples) return;
    const update = () => {
      const chips = [...samples.querySelectorAll<HTMLElement>('.constraint-chip')];
      const gap = parseFloat(getComputedStyle(samples).columnGap);
      const available = element.clientWidth - element.querySelector<HTMLElement>('.constraints-label')!.offsetWidth - parseFloat(getComputedStyle(element).columnGap);
      const moreWidth = samples.querySelector<HTMLElement>('.constraints-more')!.offsetWidth;
      let count = sections.length;
      while (count > 1 && chips.slice(0, count).reduce((width, chip) => width + chip.offsetWidth, 0) + gap * (count - 1)
        + (count < sections.length ? moreWidth + gap : 0) > available) count--;
      setVisibleCount(count);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [sections, config.language]);

  return <Dialog.Root open={current !== undefined} onOpenChange={open => { if (!open) setSelected(null); }}>
    <div className="goal-constraints" ref={row}>
      <span className="constraints-label">{t('goal.constraints')}</span>
      <div className="constraints-chips">
        {sections.slice(0, visibleCount).map((section, index) => <button key={index} className="constraint-chip" data-constraint-index={index}
          title={label(section)} aria-haspopup="dialog" onClick={() => show(index)}>{label(section)}</button>)}
        {visibleCount < sections.length && <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><button className="constraint-chip constraints-more" aria-label={t('goal.moreConstraints', { count: sections.length - visibleCount })}>+{sections.length - visibleCount}</button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="constraints-menu" align="end" sideOffset={dimension('--xs')}
            onCloseAutoFocus={event => { if (selected !== null) event.preventDefault(); }}>
            {sections.slice(visibleCount).map((section, index) => <DropdownMenu.Item key={index} onSelect={() => show(visibleCount + index)}>{label(section)}</DropdownMenu.Item>)}
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>}
      </div>
    </div>
    <div ref={measure} className="constraints-measure" aria-hidden="true" inert>
      {sections.map((section, index) => <span className="constraint-chip" key={index}>{label(section)}</span>)}
      <span className="constraint-chip constraints-more">+{sections.length}</span>
    </div>
    <Dialog.Portal>
      <Dialog.Overlay className="constraints-overlay" />
      <Dialog.Content className="constraints-dialog" aria-describedby={undefined} onCloseAutoFocus={event => {
        event.preventDefault();
        const selector = origin.current !== null && origin.current < visibleCount ? `[data-constraint-index="${origin.current}"]` : '.constraints-more';
        row.current?.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true });
      }}>
        <Dialog.Title className="agent-sr-only">{t('goal.constraints')}</Dialog.Title>
        <Markdown source={current ?? ''} />
        <Dialog.Close className="constraints-close" aria-label={t('common.close')}>×</Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
