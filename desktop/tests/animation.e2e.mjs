import { _electron as electron } from 'playwright';
import executable from 'electron';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { PolarisStore } from '../dist-service/store.js';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { LocalHost } from '../electron/host.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'polaris-animation-'));
const database = path.join(directory, 'polaris.sqlite');
const native = path.resolve(root, 'bin');
const results = path.join(root, 'test-results');
await mkdir(results, { recursive: true });
const fixture = new PolarisStore(database);
function write(kind, action, content) {
  return fixture.mutate(kind, action, undefined, { requestID: randomUUID(), ...content });
}
write('goal', 'create', { id: 'goal', title: '动画回归验证', milestone: '保留卡片的原始位置、换行和底部信息。', symbol: 'target' });
write('strategy', 'create', { id: 'strategy', goalID: 'goal', title: '卡片展开与关闭', body: '同一行不同长度的内容。', origin: 'Test' });
for (let i = 0; i < 4; i++) write('decision', 'submit', { id: `card-${i}`, strategyID: 'strategy',
  title: i === 1 ? '比较下一步' : `这是一条较长的问题，用来验证同一行卡片高度相等时，短标题的底部信息仍然对齐（${i}）`,
  body: (i === 1 ? '短摘要。' : '这段较长的摘要用于填满两行，验证原始卡片与过渡副本之间不出现文字换行和位置差异。') + '\n\n## 背景\n\n' + '这是用于动画测试的本地材料。**重要信息**在独立阅读区显示。\n\n'.repeat(10),
  options: [{ id: 'a', label: '选项 A', detail: '继续收集信息。' }, { id: 'b', label: '选项 B', detail: '调整当前方法。' }] });
fixture.close();

const env = { ...process.env, POLARIS_TEST: '1' }; env.POLARIS_TEST_NATIVE_CODEX = path.join(root, 'tests/fixtures/native-agent.mjs');
delete env.ELECTRON_RUN_AS_NODE;
let app;
const report = {};
const failures = [];
function check(value, message) { if (!value) failures.push(message); }
try {
  app = await electron.launch({ executablePath: process.env.POLARIS_APP ?? executable,
    args: [...(process.env.POLARIS_APP ? [] : [root]), '--database', database, `--user-data-dir=${path.join(directory, 'profile')}`], env, timeout: 30_000 });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-decision-id="card-1"]');
  // Measure the modal alone: let the board's entry fade finish first.
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isFocused() || window.isFocusable())), false, 'Test windows must never take desktop focus.');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  report.runtime = await app.evaluate(({ app, screen }) => ({
    electron: process.versions.electron, chrome: process.versions.chrome,
    gpu: app.getGPUFeatureStatus(), displays: screen.getAllDisplays().map(display => ({ size: display.size, scaleFactor: display.scaleFactor, frequency: display.displayFrequency })),
  }));
  report.windowMode = process.env.POLARIS_TEST_VISIBLE === '1' ? 'inactive-visible' : 'hidden';
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame,blink.user_timing,toplevel,cc,viz,benchmark', transferMode: 'ReturnAsStream' });
  await page.evaluate(() => {
    const button = document.querySelector('[data-decision-id="card-1"]');
    button.addEventListener('click', () => {
      performance.mark('polaris-open-start');
      window.animationFrames = new Promise(resolve => {
        const times = [], start = performance.now();
        function frame(time) { times.push(time); if (time - start < 650) requestAnimationFrame(frame); else resolve(times); }
        requestAnimationFrame(frame);
      });
    }, { once: true, capture: true });
  });
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
  const settle = () => page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
  const before = await metrics();
  await page.locator('[data-decision-id="card-1"]').click();
  await page.waitForSelector('.modal-close-row button'); await settle();
  const after = await metrics();
  report.openLayouts = after.LayoutCount - before.LayoutCount;
  report.openLayoutMilliseconds = (after.LayoutDuration - before.LayoutDuration) * 1000;
  check(report.openLayoutMilliseconds < 16.7, `Cold opening spends ${report.openLayoutMilliseconds.toFixed(1)}ms in layout (keyboard-symbol fallback regression).`);
  const frames = await page.evaluate(() => window.animationFrames);
  const intervals = frames.slice(1).map((value, index) => value - frames[index]);
  report.openFrames = { count: frames.length, medianInterval: [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)], longestInterval: Math.max(...intervals), over25ms: intervals.filter(value => value > 25).length };
  const completed = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end');
  const { stream } = await completed;
  let trace = '';
  for (;;) { const part = await cdp.send('IO.read', { handle: stream }); trace += part.data; if (part.eof) break; }
  await cdp.send('IO.close', { handle: stream });
  await writeFile(path.join(results, 'animation-trace.json'), trace);
  const events = JSON.parse(trace).traceEvents;
  report.rendering = Object.fromEntries(['Layout', 'Paint', 'RasterTask', 'UpdateLayoutTree', 'DrawFrame', 'DroppedFrame', 'FramePresented', 'PipelineReporter'].map(name => {
    const matching = events.filter(event => event.name === name);
    return [name, { count: matching.length, milliseconds: matching.reduce((sum, event) => sum + (event.dur ?? 0), 0) / 1000 }];
  }));
  const starts = new Map(), presented = [];
  for (const event of events.filter(event => event.name === 'PipelineReporter')) {
    const id = `${event.pid}:${event.id2?.local}`;
    if (event.ph === 'b') starts.set(id, event);
    else if (event.ph === 'e') {
      const start = starts.get(id), state = start?.args.frame_reporter;
      if (state?.has_compositor_animation && state.state.startsWith('STATE_PRESENTED')) presented.push({ pid: event.pid, time: event.ts });
      starts.delete(id);
    }
  }
  report.compositorFrames = [...new Set(presented.map(frame => frame.pid))].map(pid => {
    const times = presented.filter(frame => frame.pid === pid).map(frame => frame.time).sort((a, b) => a - b);
    const gaps = times.slice(1).map((time, i) => (time - times[i]) / 1000);
    return { pid, count: times.length, longestInterval: Math.max(...gaps), over25ms: gaps.filter(gap => gap > 25).length };
  });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal-layer', { state: 'detached' });
  await page.locator('[data-decision-id="card-1"]').click();
  await page.waitForSelector('.modal-close-row button');
  report.openingSurfaces = await page.evaluate(() => {
    const animations = document.querySelector('.modal-layer').getAnimations({ subtree: true });
    for (const animation of animations) { animation.pause(); animation.currentTime = 40; }
    const shell = document.querySelector('.modal-shell'), face = document.querySelector('.modal-card-face');
    return { shellOpacity: +getComputedStyle(shell).opacity, faceOpacity: face ? +getComputedStyle(face).opacity : 0,
      originalVisibility: getComputedStyle(document.querySelector('[data-decision-id="card-1"]')).visibility,
      cloneBackground: face?.firstElementChild ? getComputedStyle(face.firstElementChild).backgroundColor : 'rgba(0, 0, 0, 0)' };
  });
  await page.screenshot({ path: path.join(results, 'animation-opening-surfaces.png') });
  check(!(report.openingSurfaces.shellOpacity > .005 && report.openingSurfaces.faceOpacity > .005
    && report.openingSurfaces.cloneBackground !== 'rgba(0, 0, 0, 0)'), 'Opening shows the original card surface and the expanding modal surface together.');
  check(report.openingSurfaces.originalVisibility === 'hidden', 'The original card fades alongside its expanding surface instead of disappearing immediately.');
  await page.evaluate(() => document.querySelector('.modal-layer').getAnimations({ subtree: true }).forEach(animation => animation.finish()));
  report.closingContentCoverage = await page.evaluate(() => {
    document.querySelector('.modal-close-row button').click();
    const animations = document.querySelector('.modal-layer').getAnimations({ subtree: true });
    animations.forEach(animation => animation.pause());
    const samples = [0, 30, 60, 90, 100, 120, 150, 200, 240, 300, 359].map(time => {
      animations.forEach(animation => { animation.currentTime = time; });
      return { time, opacity: +getComputedStyle(document.querySelector('.modal-content')).opacity
        + +getComputedStyle(document.querySelector('.modal-card-face')).opacity };
    });
    animations.forEach(animation => animation.finish());
    return samples;
  });
  check(report.closingContentCoverage.every(sample => sample.opacity >= .99),
    'Closing briefly blanks both the modal content and the returning card text.');
  await page.waitForSelector('.modal-layer', { state: 'detached' });
  await page.locator('[data-decision-id="card-1"]').click();
  await page.waitForSelector('.modal-close-row button'); await settle();
  report.overlappingSurfaces = await page.evaluate(() => {
    document.querySelector('.modal-close-row button').click();
    const animations = [...document.querySelector('.modal-layer').getAnimations({ subtree: true })];
    animations.forEach(animation => animation.pause());
    const overlap = [];
    for (const progress of [.2, .4, .6, .8, .9]) {
      for (const animation of animations) animation.currentTime = progress * 360;
      const shell = document.querySelector('.modal-shell'), face = document.querySelector('.modal-card-face');
      if (+getComputedStyle(shell).opacity > .005 && face && +getComputedStyle(face).opacity > .005) {
        const style = getComputedStyle(face.firstElementChild), surface = shell.getBoundingClientRect(), text = face.getBoundingClientRect();
        if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.boxShadow !== 'none' || style.borderColor !== 'rgba(0, 0, 0, 0)'
            || Math.abs(surface.left - text.left) > 1 || Math.abs(surface.top - text.top) > 1) overlap.push(progress);
      }
    }
    animations.forEach(animation => animation.finish());
    return overlap;
  });
  check(report.overlappingSurfaces.length === 0, `Two card surfaces remain visible together at closing progress ${report.overlappingSurfaces.join(', ')}.`);
  await page.waitForSelector('.modal-layer', { state: 'detached' });
  await page.locator('[data-decision-id="card-1"]').click();
  await page.waitForSelector('.modal-close-row button'); await settle();
  const alignment = await page.evaluate(() => {
    const shell = document.querySelector('.modal-shell');
    document.querySelector('.modal-close-row button').click();
    const motion = shell.getAnimations().at(-1);
    const end = motion.effect.getTiming().duration - .01;
    for (const animation of document.querySelector('.modal-layer').getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = end; }
    const face = document.querySelector('.modal-card-face');
    for (const animation of face?.getAnimations() ?? []) animation.finish();
    const source = document.querySelector('[data-decision-id="card-1"]');
    const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
    return { source: box(source), face: face && box(face), sourceMeta: box(source.querySelector('.card-meta')),
      faceMeta: face?.querySelector('.card-meta') && box(face.querySelector('.card-meta')),
      shadowOpacity: +getComputedStyle(document.querySelector('.modal-shadow') ?? shell).opacity };
  });
  report.cardAlignment = alignment;
  await page.screenshot({ path: path.join(results, 'animation-close-card.png') });
  const mismatch = alignment.face ? Math.max(...['left', 'top', 'width', 'height'].map(key => Math.abs(alignment.source[key] - alignment.face[key]))) : Infinity;
  check(mismatch < 1, `Card clone differs from the actual card by ${mismatch.toFixed(2)}px.`);
  check(alignment.faceMeta && Math.abs(alignment.sourceMeta.top - alignment.faceMeta.top) < 1, 'Closing metadata moves away from the original grid-card baseline.');
  check(alignment.shadowOpacity < .05, 'The large modal shadow remains over the card at the end of closing.');
  await page.evaluate(() => document.querySelector('.modal-shell').getAnimations().forEach(animation => animation.finish()));
  await page.waitForSelector('.modal-layer', { state: 'detached' });
  check(report.openLayouts <= 10, `Opening requires ${report.openLayouts} layouts instead of a fixed-layout animation.`);

  await page.locator('[data-decision-id="card-1"]').click();
  await page.waitForSelector('.modal-close-row button');
  report.interruptionJump = await page.evaluate(() => {
    const shell = document.querySelector('.modal-shell');
    const animation = shell.getAnimations()[0]; animation.pause(); animation.currentTime = 100;
    const before = shell.getBoundingClientRect();
    document.querySelector('.modal-close-row button').click();
    const after = shell.getBoundingClientRect();
    return Math.max(Math.abs(before.left - after.left), Math.abs(before.top - after.top), Math.abs(before.width - after.width), Math.abs(before.height - after.height));
  });
  check(report.interruptionJump < 1, `Closing during opening jumps ${report.interruptionJump.toFixed(2)}px.`);
  await page.waitForSelector('.modal-layer', { state: 'detached' });

  for (let cycle = 0; cycle < 3; cycle++) {
    await page.locator('[data-decision-id="card-1"]').click();
    await page.waitForSelector('.modal-close-row button');
    await page.evaluate(() => {
      const close = document.querySelector('.modal-close-row button');
      close.click(); close.click();
      document.querySelector('.modal-content').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await page.waitForSelector('.modal-layer', { state: 'detached' });
    assert.equal(await page.locator('[data-decision-id="card-1"]').evaluate(node => getComputedStyle(node).opacity), '1');
  }
  report.rapidCloseCycles = 3;

  await page.locator('[data-decision-id="card-1"]').click();
  await page.waitForSelector('.modal-close-row button');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 700));
  await page.waitForFunction(() => innerWidth === 1100);
  await settle();
  report.resized = await page.locator('.modal-shell').evaluate(node => {
    const box = node.getBoundingClientRect();
    return { centerError: Math.abs(box.left + box.width / 2 - innerWidth / 2), top: box.top, bottom: box.bottom, viewportHeight: innerHeight };
  });
  check(report.resized.centerError < 1 && report.resized.top > 0 && report.resized.bottom < report.resized.viewportHeight, 'Resizing during opening leaves the modal outside the centered layout.');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal-layer', { state: 'detached' });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-decision-id="card-1"]').click();
  await page.waitForSelector('.modal-close-row button');
  report.reducedMotionHasMovement = await page.locator('.modal-shell').evaluate(node => node.getAnimations().some(animation =>
    animation.effect.getKeyframes().some(frame => frame.transform && frame.transform !== 'none')));
  check(!report.reducedMotionHasMovement, 'Reduced motion still scales or moves the modal.');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal-layer', { state: 'detached' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  const host = new LocalHost(path.join(native, 'polaris-host'), database);
  try { await host.call('decide', { decisionID: 'card-1', expectedVersion: 1, note: '这是一个自定义决定。' }); }
  finally { host.stop(); }
  await page.locator('[data-strategy-id]').first().click();
  await page.locator('.strategy-records .record-row').first().click();
  await page.waitForSelector('.modal-close-row button');await settle();
  await page.locator('.modal-content').press('Escape');
  await page.waitForSelector('.strategy-records');
  await page.locator('.strategy-records').press('Escape');
  await writeFile(path.join(results, 'animation-metrics.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(failures, []);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isFocused() || window.isFocusable())), false);
  console.log('PASS animation layout cost, grid-card geometry, metadata alignment, interruption, repeated close, resize, reduced motion and historical card return.');
} finally { await app?.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); }