// Arrival-rate buffer and safe Markdown boundaries, following the inspected desktop renderer.
export class StreamingTextBuffer {
  source: string;
  length: number;
  rate = 1;
  carry = 0;
  lastArrival: number | null = null;
  lastDrain: number | null = null;
  constructor(source: string) { this.source = source; this.length = source.length; }
  get text() { return this.source.slice(0, this.length); }
  update(source: string, streaming: boolean, now: number) {
    if (!streaming || !source.startsWith(this.source)) {
      this.source = source; this.length = source.length; this.rate = 1; this.carry = 0; this.lastArrival = null; this.lastDrain = null;
      return;
    }
    const added = source.length - this.source.length;
    this.source = source;
    if (added) {
      this.rate = this.lastArrival === null ? added : Math.max(1, .1 * added / Math.max((now - this.lastArrival) / 1000, .01) + .9 * this.rate);
      this.lastArrival = now;
      this.lastDrain ??= now;
    }
  }
  advance(now: number) {
    if (this.length >= this.source.length) { this.lastDrain = null; return this.text; }
    const elapsed = Math.max(0, (now - (this.lastDrain ?? now)) / 1000);
    this.lastDrain = now;
    const remaining = this.source.length - this.length;
    for (let step = 0; step < elapsed / .05; step++) {
      if (remaining < this.rate * 1.5) this.rate = (remaining + this.rate * 1.5) / 2;
      if (remaining > this.rate / 1.2) this.rate = (remaining + this.rate / 1.2) / 2;
    }
    const amount = elapsed * Math.max(1, this.rate) + this.carry;
    let next = Math.min(this.source.length, this.length + Math.floor(amount));
    this.carry = amount - Math.floor(amount);
    // Never reveal half of a UTF-16 surrogate pair.
    if (next < this.source.length && /[\uD800-\uDBFF]/.test(this.source[next - 1] ?? '')) { next--; this.carry++; }
    this.length = next;
    return this.text;
  }
}

export function markdownBlocks(source: string): string[] {
  // Reference definitions can change earlier blocks; keep their parsing context intact.
  if (/^\s*\[[^\]]+\]:|\[[^\]]+\]\s*\[/m.test(source)) return [source];
  const blocks: string[] = [];
  let start = 0, offset = 0, boundary = 0, fence = '', fenceLength = 0, math = false, directives = 0;
  for (const line of source.split(/(?<=\n)/)) {
    const text = line.replace(/\r?\n$/, ''), trimmed = text.trimStart();
    if (boundary && trimmed && !/^[\t ]|^>|^[-+*](?:\s|$)|^\d+[.)](?:\s|$)/.test(text)) {
      blocks.push(source.slice(start, boundary)); start = boundary; boundary = 0;
    } else if (trimmed) boundary = 0;
    const marker = text.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) { fence = marker[1][0]; fenceLength = marker[1].length; }
      else if (marker[1][0] === fence && marker[1].length >= fenceLength && /^\s*[`~]+\s*$/.test(text)) fence = '';
    } else if (!fence && /^\s*\$\$\s*$/.test(text)) math = !math;
    else if (!fence && /^:::[a-zA-Z]/.test(trimmed)) directives++;
    else if (!fence && /^:::\s*$/.test(trimmed)) directives = Math.max(0, directives - 1);
    offset += line.length;
    if (!fence && !math && !directives && !trimmed && line.endsWith('\n')) boundary = offset;
  }
  blocks.push(source.slice(start));
  return blocks;
}
