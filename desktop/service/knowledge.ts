import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PolarisStore } from './store.js';
import { PolarisError, encode } from './model.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const goalID = z.string().regex(/^[a-zA-Z0-9_.-]{1,120}$/);
const labels = z.array(text(80)).max(20);
const fields = z.object({ title: text(160), category: z.string().trim().max(80), body: z.string().max(200_000).refine(v => !!v.trim()),
  tags: labels, aliases: labels, sources: z.array(text(2000)).max(20), goalIDs: z.array(goalID).max(100) });
export const knowledgeWriteSchema = fields.partial().extend({ id: z.string().uuid().optional(), expectedVersion: z.number().int().min(0), rulesVersion: z.number().int().min(0) });
const saveSchema = fields.partial().extend({ id: z.string().uuid().optional(), expectedVersion: z.number().int().min(0), requestID: text(300) });
const versionSchema = z.object({ id: z.string().uuid(), expectedVersion: z.number().int().positive(), requestID: text(300) });
export const knowledgeListSchema = z.object({ query: z.string().max(300).default(''), goalID: goalID.optional(),
  status: z.enum(['active', 'archived']).default('active'), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(40) });
export const knowledgeBrowseSchema = z.object({ category: z.string().trim().max(80).optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50) });
export const knowledgeFindSchema = z.object({ query: z.string().max(300).default(''), category: z.string().trim().max(80).optional(),
  offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(20) });
export const knowledgeReadSchema = z.object({ id: z.string().uuid(), section: z.string().trim().min(1).max(200).optional(), full: z.boolean().default(false) });
const longDocument = 6000;
export type KnowledgeDocument = z.infer<typeof fields> & { id: string; version: number; status: 'active' | 'archived'; createdAt: string; updatedAt: string; updatedBy: 'user' | 'agent'; jobID?: string };
export type KnowledgeSummary = Pick<KnowledgeDocument, 'id' | 'version' | 'status' | 'title' | 'category' | 'updatedAt' | 'updatedBy'> & { excerpt: string };
export type KnowledgeRules = { body: string; version: number };
export type KnowledgeAccess = { goalID?: string; jobID: string; rulesVersion?: number };
const normalize = (value: string) => value.normalize('NFKC').toLowerCase();
const brief = ({ id, version, status, title, category, updatedAt, updatedBy, excerpt }: KnowledgeSummary): KnowledgeSummary => ({ id, version, status, title, category, updatedAt, updatedBy, excerpt });
const summary = ({ body, ...doc }: KnowledgeDocument): KnowledgeSummary => brief({ ...doc, excerpt: body.replace(/\s+/g, ' ').slice(0, 240) });
const invalid = () => new PolarisError('invalid_input', 'Invalid knowledge fields or Markdown metadata.', 'knowledge.invalid');
const conflict = () => new PolarisError('conflict', 'This document or its rules changed. Read the latest version before saving.', 'knowledge.conflict');
const missing = () => new PolarisError('not_found', 'Document not found in this scope.', 'knowledge.notFound');
/** A short window of the body around the first matching word, so results show why they matched. */
function excerptAround(body: string, words: string[]) {
  const flat = body.replace(/\s+/g, ' ').trim(), folded = normalize(flat);
  const hit = words.map(word => folded.indexOf(word)).find(index => index >= 0) ?? 0, start = Math.max(0, hit - 60);
  return `${start ? '…' : ''}${flat.slice(start, start + 160)}${start + 160 < flat.length ? '…' : ''}`;
}
function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> { const result = schema.safeParse(value); if (!result.success) throw invalid(); return result.data; }

export class KnowledgeStore {
  constructor(readonly store: PolarisStore) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS knowledge (id TEXT PRIMARY KEY, status TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL, searchText TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS knowledge_goal (documentID TEXT NOT NULL REFERENCES knowledge(id), goalID TEXT NOT NULL REFERENCES goal(id), PRIMARY KEY(documentID,goalID));
      CREATE INDEX IF NOT EXISTS knowledge_by_goal ON knowledge_goal(goalID,documentID)`);
    store.query("INSERT OR IGNORE INTO metadata(key,value) VALUES('knowledge.workspace',?)", randomUUID());
  }
  private workspace() { return String(this.store.query("SELECT value FROM metadata WHERE key='knowledge.workspace'")[0].value); }
  read(id: string, access?: KnowledgeAccess): KnowledgeDocument {
    const row = this.store.query(`SELECT summary,body FROM knowledge WHERE id=?${access?.goalID ? ' AND EXISTS(SELECT 1 FROM knowledge_goal WHERE documentID=knowledge.id AND goalID=?)' : ''}`, id, ...access?.goalID ? [access.goalID] : [])[0];
    if (!row) throw missing();
    const { excerpt, ...doc } = JSON.parse(String(row.summary));
    return { ...doc, body: String(row.body) };
  }
  list(input: unknown = {}, access?: KnowledgeAccess) {
    const args = parse(knowledgeListSchema, input), goalID = access?.goalID ?? args.goalID;
    if (access?.goalID && args.goalID && args.goalID !== access.goalID) throw missing();
    const where = ['status=?'], values: (string | number)[] = [args.status];
    if (goalID) { where.push('EXISTS(SELECT 1 FROM knowledge_goal WHERE documentID=knowledge.id AND goalID=?)'); values.push(goalID); }
    // shortcut: substring search keeps Chinese and aliases usable without an index service; add FTS when real library sizes warrant it.
    for (const word of normalize(args.query).trim().split(/\s+/).filter(Boolean)) { where.push('instr(searchText,?)>0'); values.push(word); }
    const clause = where.join(' AND '), total = Number(this.store.query(`SELECT count(*) AS n FROM knowledge WHERE ${clause}`, ...values)[0].n);
    const documents = this.store.query(`SELECT summary FROM knowledge WHERE ${clause} ORDER BY rowid DESC LIMIT ? OFFSET ?`, ...values, args.limit, args.offset).map(row => brief(JSON.parse(String(row.summary))));
    return { documents, total, nextOffset: args.offset + documents.length < total ? args.offset + documents.length : null };
  }
  rules(): KnowledgeRules {
    const row = this.store.query("SELECT value FROM metadata WHERE key='knowledge.rules'")[0];
    return row ? JSON.parse(String(row.value)) : { version: 0, body: '' };
  }
  saveRules(input: unknown) {
    const args = parse(z.object({ body: z.string().max(8000), expectedVersion: z.number().int().min(0), requestID: text(300) }), input);
    return this.mutation(args.requestID, ['rules', args], () => {
      if (this.rules().version !== args.expectedVersion) throw conflict();
      const rules = { version: args.expectedVersion + 1, body: args.body };
      this.store.query("INSERT INTO metadata(key,value) VALUES('knowledge.rules',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", encode(rules));
      this.store.query("INSERT INTO revision(kind,entity_id,version,payload) VALUES('knowledge_rules','workspace',?,?)", rules.version, encode(rules));
      return rules;
    });
  }
  private mutation<T>(requestID: string, fingerprint: unknown, perform: () => T): T {
    return this.store.transaction(() => {
      const key = `knowledge:${requestID}`, value = encode(fingerprint), prior = this.store.query('SELECT fingerprint,response FROM request WHERE id=?', key)[0];
      if (prior) { if (prior.fingerprint !== value) throw conflict(); return JSON.parse(String(prior.response)); }
      const result = perform();
      this.store.query('INSERT INTO request(id,fingerprint,response) VALUES(?,?,?)', key, value, encode(result));
      return result;
    });
  }
  private persist(doc: KnowledgeDocument) {
    const info = { ...doc, body: undefined, excerpt: summary(doc).excerpt };
    if (Buffer.byteLength(encode(doc)) > 900_000) throw invalid();
    this.store.query(`INSERT INTO knowledge(id,status,summary,body,searchText) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,summary=excluded.summary,body=excluded.body,searchText=excluded.searchText`, doc.id, doc.status, encode(info), doc.body,
      normalize([doc.title, doc.category, ...doc.tags, ...doc.aliases, ...doc.sources, doc.body].join('\n')));
    this.store.query('DELETE FROM knowledge_goal WHERE documentID=?', doc.id);
    for (const goalID of doc.goalIDs) this.store.query('INSERT INTO knowledge_goal(documentID,goalID) VALUES(?,?)', doc.id, goalID);
    this.store.query("INSERT INTO revision(kind,entity_id,version,payload) VALUES('knowledge',?,?,?)", doc.id, doc.version, encode(doc));
    return doc;
  }
  save(input: unknown, access?: KnowledgeAccess): KnowledgeDocument {
    const args = parse(saveSchema, input);
    return this.store.transaction(() => {
      const prior = args.id ? this.read(args.id, access) : undefined;
      const supplied = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
      const content = parse(fields, { category: '', tags: [], aliases: [], sources: [], goalIDs: access?.goalID ? [access.goalID] : [], ...prior, ...supplied });
      if (access) {
        if (access.rulesVersion !== this.rules().version) throw conflict();
        if (!content.sources.length) throw new PolarisError('invalid_input', 'Provide the source of these facts.', 'knowledge.sourceRequired');
        if (access.goalID) {
          const permitted = prior?.goalIDs ?? [access.goalID];
          if (args.goalIDs && encode([...new Set(args.goalIDs)].sort()) !== encode([...permitted].sort())) throw new PolarisError('invalid_input', 'A task cannot change document visibility.', 'knowledge.scope');
          content.goalIDs = permitted;
        }
      }
      const result = this.mutation(args.requestID, ['save', args, access ?? null], () => {
        if ((prior?.version ?? 0) !== args.expectedVersion || prior?.status === 'archived') throw conflict();
        for (const id of content.goalIDs) { if (!prior?.goalIDs.includes(id) && !this.store.query("SELECT 1 FROM goal WHERE id=? AND status='active'", id).length) throw invalid(); }
        return this.persist({ ...content, id: prior?.id ?? randomUUID(), goalIDs: [...new Set(content.goalIDs)], tags: [...new Set(content.tags)], aliases: [...new Set(content.aliases)],
          version: args.expectedVersion + 1, status: 'active', createdAt: prior?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
          updatedBy: access ? 'agent' : 'user', ...(access ? { jobID: access.jobID } : {}) });
      });
      if (access) this.read(result.id, access);
      return result;
    });
  }
  archive(input: unknown) {
    const args = parse(versionSchema, input);
    return this.mutation(args.requestID, ['archive', args], () => {
      const doc = this.read(args.id); if (doc.version !== args.expectedVersion) throw conflict();
      return this.persist({ ...doc, status: 'archived', version: doc.version + 1, updatedAt: new Date().toISOString(), updatedBy: 'user', jobID: undefined });
    });
  }
  history(id: string) {
    this.read(id);
    return this.store.query("SELECT payload FROM revision WHERE kind='knowledge' AND entity_id=? ORDER BY version DESC LIMIT 100", id).map(row => summary(JSON.parse(String(row.payload)) as KnowledgeDocument));
  }
  revision(id: string, version: number): KnowledgeDocument {
    this.read(id);
    const row = this.store.query("SELECT payload FROM revision WHERE kind='knowledge' AND entity_id=? AND version=?", id, version)[0];
    if (!row) throw missing(); return JSON.parse(String(row.payload));
  }
  restore(input: unknown) {
    const args = parse(versionSchema.extend({ version: z.number().int().positive() }), input);
    return this.mutation(args.requestID, ['restore', args], () => {
      const doc = this.read(args.id); if (doc.version !== args.expectedVersion) throw conflict();
      // Historical links do not grant access again; restoration retains the current sharing scope.
      return this.persist({ ...this.revision(args.id, args.version), goalIDs: doc.goalIDs, status: 'active', version: doc.version + 1, updatedAt: new Date().toISOString(), updatedBy: 'user', jobID: undefined });
    });
  }
  /** Budgeted catalog for the public CLI `context` contract; built-in Agents start from overview instead (R-D128). */
  context(goalID?: string) {
    const list = this.list({ goalID, limit: 40 }), documents: Pick<KnowledgeSummary, 'id' | 'version' | 'title' | 'category' | 'excerpt'>[] = [];
    let remaining = 6000;
    for (const { id, version, title, category, excerpt } of list.documents) {
      const doc = { id, version, title, category, excerpt }, size = encode(doc).length;
      if (size > remaining) break; remaining -= size; documents.push(doc);
    }
    return { rules: this.rules(), documents, total: list.total, hasMore: documents.length < list.total };
  }
  private scope(goalID?: string, category?: string) {
    const where = ["status='active'"], values: string[] = [];
    if (goalID) { where.push('EXISTS(SELECT 1 FROM knowledge_goal WHERE documentID=knowledge.id AND goalID=?)'); values.push(goalID); }
    if (category !== undefined) { where.push("json_extract(summary,'$.category')=?"); values.push(category); }
    return { clause: where.join(' AND '), values };
  }
  /** The one-line state a task starts with; Agents look documents up with browse and find (R-D128). */
  overview(goalID?: string) {
    const { clause, values } = this.scope(goalID);
    const rows = this.store.query(`SELECT json_extract(summary,'$.category') AS category,count(*) AS n FROM knowledge WHERE ${clause} GROUP BY 1 ORDER BY n DESC,1`, ...values);
    return { total: rows.reduce((sum, row) => sum + Number(row.n), 0), categories: Object.fromEntries(rows.map(row => [String(row.category ?? ''), Number(row.n)])) };
  }
  browse(input: unknown, access?: KnowledgeAccess) {
    const args = parse(knowledgeBrowseSchema, input);
    if (args.category === undefined) return this.overview(access?.goalID);
    const { clause, values } = this.scope(access?.goalID, args.category), total = Number(this.store.query(`SELECT count(*) AS n FROM knowledge WHERE ${clause}`, ...values)[0].n);
    const documents = this.store.query(`SELECT summary FROM knowledge WHERE ${clause} ORDER BY json_extract(summary,'$.updatedAt') DESC,rowid DESC LIMIT ? OFFSET ?`, ...values, args.limit, args.offset)
      .map(row => { const { id, title, updatedAt } = JSON.parse(String(row.summary)) as KnowledgeDocument; return { id, title, updatedAt }; });
    return { category: args.category, documents, total, nextOffset: args.offset + documents.length < total ? args.offset + documents.length : null };
  }
  find(input: unknown, access?: KnowledgeAccess) {
    const args = parse(knowledgeFindSchema, input), words = normalize(args.query).trim().split(/\s+/).filter(Boolean);
    const { clause, values } = this.scope(access?.goalID, args.category);
    const matches = this.store.query(`SELECT summary FROM knowledge WHERE ${clause}${' AND instr(searchText,?)>0'.repeat(words.length)}`, ...values, ...words)
      .map(row => JSON.parse(String(row.summary)) as Omit<KnowledgeDocument, 'body'>);
    // Title hits rank first, then aliases and tags, then category; ties go to the latest update.
    const score = (doc: Omit<KnowledgeDocument, 'body'>) => words.reduce((sum, word) => sum + (normalize(doc.title).includes(word) ? 4 : 0)
      + ([...doc.aliases, ...doc.tags].some(label => normalize(label).includes(word)) ? 2 : 0) + (normalize(doc.category).includes(word) ? 1 : 0), 0);
    matches.sort((a, b) => score(b) - score(a) || b.updatedAt.localeCompare(a.updatedAt));
    const documents = matches.slice(args.offset, args.offset + args.limit).map(doc => ({ id: doc.id, title: doc.title, category: doc.category, updatedAt: doc.updatedAt,
      excerpt: excerptAround(String(this.store.query('SELECT body FROM knowledge WHERE id=?', doc.id)[0].body), words) }));
    return { documents, total: matches.length, nextOffset: args.offset + documents.length < matches.length ? args.offset + documents.length : null };
  }
  /** Long documents answer with their outline first, then one section at a time; full returns everything for rewriting. */
  readPart(input: unknown, access?: KnowledgeAccess) {
    const args = parse(knowledgeReadSchema, input), doc = this.read(args.id, access), lines = doc.body.split('\n');
    const headings = lines.flatMap((line, index) => { const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line); return match ? [{ index, level: match[1].length, title: match[2] }] : []; });
    if (args.full || !headings.length || (!args.section && doc.body.length <= longDocument)) return doc;
    const end = (i: number) => headings.slice(i + 1).find(next => next.level <= headings[i].level)?.index ?? lines.length;
    const { body, ...meta } = doc;
    if (!args.section) return { ...meta, length: body.length, outline: headings.map((heading, i) => ({ section: heading.title, level: heading.level, length: lines.slice(heading.index, end(i)).join('\n').length })),
      instruction: 'Long document. Read one section with section, or set full to true for the whole body, which is required before rewriting it.' };
    const i = headings.findIndex(heading => normalize(heading.title) === normalize(args.section!.replace(/^#+\s*/, '')));
    if (i < 0) throw new PolarisError('not_found', 'Section not found. Read the outline first.', 'knowledge.notFound');
    return { ...meta, section: headings[i].title, text: lines.slice(headings[i].index, end(i)).join('\n') };
  }
  exportMarkdown(id: string) {
    const doc = this.read(id);
    const metadata = { workspace: this.workspace(), id: doc.id, version: doc.version, title: doc.title, category: doc.category, tags: doc.tags, aliases: doc.aliases, sources: doc.sources, goalIDs: doc.goalIDs };
    return { filename: `${doc.title.replace(/[/\\:*?"<>|\x00-\x1f]/g, '_').slice(0, 100) || 'document'}.md`,
      markdown: `<!-- polaris-knowledge:v1 ${encode(metadata).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')} -->\n\n${doc.body}` };
  }
  importMarkdown(input: unknown) {
    const args = parse(z.object({ markdown: z.string().max(1_048_576), filename: text(255), goalID: goalID.optional(), requestID: text(300) }), input);
    return this.mutation(args.requestID, ['import', args], () => {
      const raw = args.markdown.replace(/^\uFEFF/, '');
      // Keep previously exported files importable; new exports use the Polaris marker.
      const prefix = raw.startsWith('<!-- resolve-knowledge:') ? 'resolve-knowledge' : 'polaris-knowledge';
      const marker = `<!-- ${prefix}:v1 `;
      let body = raw, metadata: z.infer<typeof fields> & { workspace: string; id: string; version: number } | undefined;
      if (raw.startsWith(`<!-- ${prefix}:`)) {
        const ending = / -->\r?\n\r?\n/.exec(raw);
        if (!raw.startsWith(marker) || !ending || ending.index > 900_000) throw invalid();
        const end = ending.index; body = raw.slice(end + ending[0].length);
        let decoded; try { decoded = JSON.parse(raw.slice(marker.length, end)); } catch { throw invalid(); }
        metadata = parse(fields.extend({ workspace: z.string().uuid(), id: z.string().uuid(), version: z.number().int().positive() }), { ...decoded, body });
      }
      const sameWorkspace = metadata?.workspace === this.workspace();
      return this.save({ title: metadata?.title ?? (body.match(/^#\s+(.+)$/m)?.[1] ?? args.filename.replace(/\.md$/i, '')).slice(0, 160),
        category: metadata?.category ?? '', tags: metadata?.tags ?? [], aliases: metadata?.aliases ?? [], sources: metadata?.sources ?? [args.filename], body,
        goalIDs: sameWorkspace ? metadata!.goalIDs : args.goalID ? [args.goalID] : [],
        ...(sameWorkspace ? { id: metadata!.id } : {}), expectedVersion: sameWorkspace ? metadata!.version : 0, requestID: `import:${args.requestID}` });
    });
  }
}
