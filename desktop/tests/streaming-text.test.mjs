import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownBlocks, StreamingTextBuffer } from '../src/streaming-text.ts';

test('adaptive buffer advances only received text and flushes immediately at completion or replacement', () => {
  const buffer = new StreamingTextBuffer('Start ');
  buffer.update('Start ' + 'word '.repeat(20), true, 0);
  let previous = buffer.text;
  for (let time = 50; time <= 500; time += 50) {
    const text = buffer.advance(time);
    assert.ok(text.startsWith(previous)); assert.ok(buffer.source.startsWith(text)); previous = text;
  }
  assert.ok(buffer.text.length > 6 && buffer.text.length < buffer.source.length);
  buffer.update(buffer.source, false, 501); assert.equal(buffer.text, buffer.source);
  buffer.update('Corrected response', true, 550); assert.equal(buffer.text, 'Corrected response');
});

test('buffer never reveals half of an emoji', () => {
  const buffer = new StreamingTextBuffer('');
  buffer.update('🧑🧑🧑 Done', true, 0);
  for (let time = 50; time < 2500; time += 50) assert.ok(!/[\uD800-\uDBFF]$/.test(buffer.advance(time)));
});

test('Markdown reuses stable paragraphs without breaking fenced code, lists or reference context', () => {
  const prefix = '# Heading\n\nFirst **paragraph**.\n\n';
  const initial = markdownBlocks(prefix + 'Partial');
  const later = markdownBlocks(prefix + 'Partial response keeps growing.');
  assert.deepEqual(initial.slice(0, -1), later.slice(0, -1));
  const code = 'Before\n\n```js\nlet a = 1;\n\na += 2;\n```\n\nAfter';
  const blocks = markdownBlocks(code);
  assert.equal(blocks.join(''), code); assert.ok(blocks.some(block => block.includes('let a = 1;\n\na += 2;')));
  const quotedFence = '```\n```not-a-closing-fence\n\nStill code\n```\n\nAfter';
  assert.ok(markdownBlocks(quotedFence)[0].includes('Still code'));
  const list = '- One\n\n  More details\n\n- Two\n\nAfter';
  assert.ok(markdownBlocks(list)[0].includes('- Two'));
  const reference = '[source][ref]\n\nMore text\n\n[ref]: https://example.com';
  assert.deepEqual(markdownBlocks(reference), [reference]);
});
