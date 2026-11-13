import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { swapIn, swapOut, usePresence } from './motion';
import { dimension } from './theme';
import { Markdown } from './Markdown';
import { call } from './types';
import { translator } from './i18n';
import { useLocale } from './LocaleProvider';
import type { KnowledgeDocument, KnowledgeRules, KnowledgeSummary } from '../service/knowledge';

type Listing = { documents: KnowledgeSummary[]; total: number; nextOffset: number | null };
type View = 'list' | 'read' | 'edit' | 'history' | 'version' | 'archived' | 'rules';
type Item = { label: string; act(): void };

async function everything(params: Record<string, unknown>) {
  const documents: KnowledgeSummary[] = [];
  for (let offset: number | null = 0; offset !== null && documents.length < 1000;) {
    const page: Listing = await call('knowledgeList', { ...params, offset, limit: 100 }); documents.push(...page.documents); offset = page.nextOffset;
  }
  return documents;
}

// Imported Markdown often opens with the same H1 as the title; show the title once without changing the stored body.
const withoutTitle = ({ title, body }: { title: string; body: string }) => {
  const [first, ...rest] = body.split('\n'), heading = /^#\s+(.+?)\s*#*\s*$/.exec(first);
  return heading && heading[1].trim() === title.trim() ? rest.join('\n').trimStart() : body;
};

function Menu({ label, items, disabled }: { label: string; items: Item[]; disabled: boolean }) {
  const [open, setOpen] = useState(false), host = useRef<HTMLDivElement>(null);
  const menu = usePresence(open);
  useEffect(() => {
    if (!open) return;
    host.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const away = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away); return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  return <div className="library-menu" ref={host} onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); host.current?.querySelector('button')?.focus(); } }}>
    <button className="library-icon-button" aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg></button>
    {menu.present && <div className={`library-menu-items ${menu.closing ? 'surface-closing' : ''}`} inert={menu.closing || undefined} role="menu">{items.map(item => <button key={item.label} role="menuitem" onClick={() => { setOpen(false); item.act(); }}>{item.label}</button>)}</div>}
  </div>;
}

/** The Agent's long-term memory: browse what it knows, read, correct (R-D127). Filing, linking and adding go through the Agent. */
export function KnowledgeLibrary({ hidden }: { hidden: boolean }) {
  const { config } = useLocale(), t = translator(config.language);
  const [view, setView] = useState<View>('list'), [query, setQuery] = useState(''), [refresh, setRefresh] = useState(0);
  const [documents, setDocuments] = useState<KnowledgeSummary[]>(), [archived, setArchived] = useState<KnowledgeSummary[]>([]), [dates, setDates] = useState<Record<string, string>>({});
  const [doc, setDoc] = useState<KnowledgeDocument>(), [versions, setVersions] = useState<KnowledgeSummary[]>([]), [version, setVersion] = useState<KnowledgeDocument>();
  const [draft, setDraft] = useState({ title: '', body: '' }), [rules, setRules] = useState<KnowledgeRules>(), [ruleBody, setRuleBody] = useState('');
  const [dirty, setDirty] = useState(false), [pending, setPending] = useState<(() => void)>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const page = useRef<HTMLElement>(null), column = useRef<HTMLDivElement>(null);
  const request = () => crypto.randomUUID();
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await action(); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } };
  // R-D169: deeper pages push in from the right and going back pulls from the left; the list keeps its scroll position.
  const depth: Record<View, number> = { list: 0, archived: 1, rules: 1, read: 2, edit: 3, history: 3, version: 4 };
  const listScroll = useRef(0), entering = useRef(0), viewRef = useRef(view); viewRef.current = view;
  const go = (next: View) => {
    const from = viewRef.current, direction = Math.sign(depth[next] - depth[from]) || 1, push = dimension('--motion-push');
    if (from === 'list') listScroll.current = page.current?.scrollTop ?? 0;
    const apply = () => { entering.current = direction * push; setView(next); setDirty(false); setPending(undefined); };
    if (from === next) { apply(); return; }
    void swapOut(column.current, `translateX(${-direction * push}px)`, '--motion-push-out').then(apply);
  };
  useLayoutEffect(() => {
    if (!entering.current) return;
    page.current?.scrollTo({ top: view === 'list' ? listScroll.current : 0 });
    swapIn(column.current, `translateX(${entering.current}px)`, '--motion-push-in'); entering.current = 0;
  }, [view]);
  // Coming back from the board, the page fades in rather than appearing at once.
  const wasHidden = useRef(true);
  useLayoutEffect(() => { if (!hidden && wasHidden.current) swapIn(page.current, 'none'); wasHidden.current = hidden; }, [hidden]);
  const leave = (action: () => void) => { if (busy) return; if (dirty) setPending(() => action); else action(); };
  const open = (id: string) => leave(() => void run(async () => { setDoc(await call('knowledgeRead', { id })); go('read'); }));
  useEffect(() => {
    // CLI and Agent writes share this database; keep the list current while the page is visible.
    if (hidden) return;
    const timer = setInterval(() => setRefresh(n => n + 1), 2000); return () => clearInterval(timer);
  }, [hidden]);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => void everything({ query }).then(value => { if (alive) setDocuments(value); }).catch(failure => { if (alive) setError(failure.message); }), 150);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, refresh]);
  useEffect(() => {
    const values = [...new Set([...(documents ?? []), ...archived, ...versions].map(item => item.updatedAt))];
    if (values.length) void call('relativeDates', { dates: values, language: config.language }).then(setDates).catch(() => {});
  }, [documents, archived, versions, config.language]);
  const when = (item: { updatedAt: string }) => dates[item.updatedAt] ?? new Date(item.updatedAt).toLocaleDateString(config.language);
  const byline = (item: KnowledgeDocument | KnowledgeSummary) => t(item.updatedBy === 'agent' ? 'knowledge.updatedByAgent' : 'knowledge.updatedByUser', { time: when(item) });
  const changed = view === 'read' && doc && documents?.some(item => item.id === doc.id && item.version !== doc.version);
  const back = (label: string, target: () => void) => <button className="library-back" onClick={() => leave(target)}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>{label}</button>;
  const rows = (items: KnowledgeSummary[]) => items.map(item => <button key={item.id} className="library-row" disabled={busy} onClick={() => open(item.id)}><strong>{item.title}</strong><time>{when(item)}</time></button>);

  let body: ReactNode;
  if (view === 'list') {
    const groups = new Map<string, KnowledgeSummary[]>();
    for (const item of [...(documents ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) groups.set(item.category, [...groups.get(item.category) ?? [], item]);
    body = <>
      <header className="library-head"><h1>{t('knowledge.library')}</h1>
        <input type="search" aria-label={t('knowledge.search')} placeholder={t('knowledge.search')} value={query} onChange={e => setQuery(e.target.value)} />
        <Menu label={t('common.moreActions')} disabled={busy} items={[
          { label: t('knowledge.import'), act: () => void run(async () => { const imported = await call('knowledgeImport', { requestID: request() }); if (imported) { setDoc(imported); go('read'); setRefresh(n => n + 1); } }) },
          { label: t('knowledge.archived'), act: () => void run(async () => { setArchived(await everything({ status: 'archived' })); go('archived'); }) },
          { label: t('knowledge.rules'), act: () => void run(async () => { const value = await call('knowledgeRules'); setRules(value); setRuleBody(value.body); go('rules'); }) },
        ]} /></header>
      {documents && !documents.length && <p className="library-hint">{query ? t('knowledge.empty') : t('knowledge.emptyLibrary')}</p>}
      {[...groups].map(([category, items]) => <section key={category} className="library-group"><h2>{category || t('knowledge.uncategorized')}</h2>{rows(items)}</section>)}
    </>;
  } else if (view === 'archived') {
    body = <>{back(t('knowledge.library'), () => go('list'))}<h1 className="library-title">{t('knowledge.archived')}</h1>
      {archived.length ? rows(archived) : <p className="library-hint">{t('knowledge.empty')}</p>}</>;
  } else if (view === 'rules' && rules) {
    body = <form onSubmit={e => { e.preventDefault(); void run(async () => { const value = await call('knowledgeRulesSave', { body: ruleBody, expectedVersion: rules.version, requestID: request() }); setRules(value); setDirty(false); setNotice(t('knowledge.saved')); }); }}>
      {back(t('knowledge.library'), () => go('list'))}<h1 className="library-title">{t('knowledge.rules')}</h1><p className="library-hint">{t('knowledge.rulesHelp')}</p>
      <textarea className="library-editor" aria-label={t('knowledge.rulesBody')} value={ruleBody} maxLength={8000} disabled={busy} onChange={e => { setRuleBody(e.target.value); setDirty(true); }} />
      <div className="library-actions"><button type="button" disabled={busy} onClick={() => leave(() => go('list'))}>{t('common.cancel')}</button><button type="submit" className="library-primary" disabled={busy || !dirty}>{t('knowledge.save')}</button></div>
    </form>;
  } else if (view === 'edit' && doc) {
    body = <form onSubmit={e => { e.preventDefault(); void run(async () => {
      const saved = await call('knowledgeSave', { title: draft.title, body: draft.body, category: doc.category, tags: doc.tags, aliases: doc.aliases, sources: doc.sources, goalIDs: doc.goalIDs, id: doc.id, expectedVersion: doc.version, requestID: request() });
      setDoc(saved); go('read'); setRefresh(n => n + 1);
    }); }}>
      <input className="library-title-input" aria-label={t('knowledge.name')} placeholder={t('knowledge.name')} required maxLength={160} value={draft.title} disabled={busy} onChange={e => { setDraft({ ...draft, title: e.target.value }); setDirty(true); }} />
      <textarea className="library-editor" aria-label={t('knowledge.body')} placeholder={t('knowledge.body')} required maxLength={200000} value={draft.body} disabled={busy} autoFocus onChange={e => { setDraft({ ...draft, body: e.target.value }); setDirty(true); }} />
      <div className="library-actions"><button type="button" disabled={busy} onClick={() => leave(() => go('read'))}>{t('common.cancel')}</button><button type="submit" className="library-primary" disabled={busy}>{t('knowledge.save')}</button></div>
    </form>;
  } else if (view === 'history' && doc) {
    body = <>{back(doc.title, () => go('read'))}<h1 className="library-title">{t('knowledge.history')}</h1>
      {versions.map(item => <button key={item.version} className="library-row" disabled={busy || item.version === doc.version}
        onClick={() => void run(async () => { setVersion(await call('knowledgeRevision', { id: doc.id, version: item.version })); go('version'); })}>
        <strong>{t('knowledge.versionValue', { version: item.version })}</strong><time>{item.version === doc.version ? t('knowledge.currentVersion') : byline(item)}</time></button>)}</>;
  } else if ((view === 'read' || view === 'version') && doc) {
    const shown = view === 'version' && version ? version : doc, old = doc.status === 'archived';
    body = <article>
      {view === 'version' ? back(t('knowledge.history'), () => go('history')) : back(old ? t('knowledge.archived') : t('knowledge.library'), () => go(old ? 'archived' : 'list'))}
      {changed && <p className="library-notice">{t('knowledge.changed')} <button disabled={busy} onClick={() => open(doc.id)}>{t('knowledge.reload')}</button></p>}
      <header className="library-doc-head"><h1>{shown.title}</h1>
        {view === 'version' || old ? <button className="library-text-button" disabled={busy} onClick={() => void run(async () => {
          setDoc(await call('knowledgeRestore', { id: doc.id, expectedVersion: doc.version, version: shown.version, requestID: request() })); go('read'); setRefresh(n => n + 1);
        })}>{t('knowledge.restore')}</button> : <>
          <button className="library-text-button" disabled={busy} onClick={() => { setDraft({ title: doc.title, body: doc.body }); go('edit'); }}>{t('knowledge.edit')}</button>
          <Menu label={t('common.moreActions')} disabled={busy} items={[
            { label: t('knowledge.history'), act: () => void run(async () => { const [latest, list] = await Promise.all([call('knowledgeRead', { id: doc.id }), call('knowledgeHistory', { id: doc.id })]); setDoc(latest); setVersions(list); go('history'); }) },
            { label: t('knowledge.export'), act: () => void run(async () => { if (await call('knowledgeExport', { id: doc.id })) setNotice(t('knowledge.exported')); }) },
            { label: t('knowledge.archive'), act: () => void run(async () => { await call('knowledgeArchive', { id: doc.id, expectedVersion: doc.version, requestID: request() }); setRefresh(n => n + 1); go('list'); }) },
          ]} /></>}
      </header>
      <Markdown source={withoutTitle(shown)} />
      <p className="library-provenance">{shown.sources.length > 0 && <>{t('knowledge.sourcesLine', { sources: shown.sources.join(' · ') })}<br /></>}{byline(shown)}</p>
    </article>;
  }
  return <main ref={page} className="library" hidden={hidden} aria-busy={busy}><div ref={column} className="library-column">
    {error && <p className="library-error" role="alert">{error}</p>}
    {notice && <p className="library-status" role="status">{notice}</p>}
    {pending && <div className="library-notice" role="alert"><p>{t('knowledge.unsaved')}</p>
      <button onClick={() => { const action = pending; setPending(undefined); setDirty(false); action(); }}>{t('knowledge.discard')}</button> <button onClick={() => setPending(undefined)}>{t('common.cancel')}</button></div>}
    {body}
  </div></main>;
}
