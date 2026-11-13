// Opt-in live subscription evaluation. Uses independent databases; never runs in the normal test suite.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PolarisStore } from '../dist-service/store.js';
import { AgentCoordinator } from '../dist-service/agent-coordinator.js';
import { discover, inspectConnection } from '../dist-service/agents/discovery.js';
import { connectCodex } from '../dist-service/agents/codex.js';
import { connectACP } from '../dist-service/agents/acp.js';

assert.equal(process.env.POLARIS_EVAL_NATIVE, '1', 'Set POLARIS_EVAL_NATIVE=1 to use the signed-in native subscription.');
assert.notEqual(process.env.POLARIS_TEST, '1', 'Live evaluation must not use a protocol fixture.');
const provider = process.env.POLARIS_EVAL_PROVIDER ?? 'chatgpt-codex';
const repeats = Number(process.env.POLARIS_EVAL_REPEATS ?? '1');
assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 3);
const connection = await inspectConnection(await discover(provider));
assert.ok(connection.connected, `${provider}: ${connection.error || 'Sign in through its native CLI first.'}`);
if (process.env.POLARIS_EVAL_MODEL) connection.model = process.env.POLARIS_EVAL_MODEL;
console.log(JSON.stringify({ provider, version: connection.version, model: connection.model || 'native default', repeats }));
const results = [];
const cases = ['understand', 'discuss', 'capabilities', 'project_intro', 'personal_goal', 'goal_discovery', 'planning_continue', 'planning_stop', 'create', 'knowledge', 'task_question', 'task_decision', 'automatic_language', 'strategy_breadth', 'initial_strategies'];
const selected = process.env.POLARIS_EVAL_CASES?.split(',') ?? cases;
assert.ok(selected.every(name => cases.includes(name)));
for (let trial = 1; trial <= repeats; trial++) for (const name of selected) {
  console.log(`START ${name} ${trial}`);
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-prompt-eval-'));
  const project = path.join(dir, 'tutorial-project'); await mkdir(project);
  const readme = '# 家具教程\n浏览器中的家具组装教程。商家编辑步骤，买家通过链接逐步查看。当前只有本地 JSON 演示，没有登录、支付和线上部署。\n';
  await writeFile(path.join(project, 'README.md'), readme);
  await writeFile(path.join(project, 'index.html'), '<!doctype html><html lang="zh"><title>家具教程</title><body><ol><li>安装桌腿</li><li>固定桌面</li></ol></body></html>');
  const store = new PolarisStore(path.join(dir, 'polaris.sqlite'));
  let protocolError;
  const runtime = new AgentCoordinator(store, () => {}, async options => {
    const capture = error => {
      protocolError = String(error.message).replaceAll(options.mcp.env.POLARIS_MCP_TOKEN, '[redacted]').slice(0, 500);
      throw error;
    };
    try {
      const session = await (provider === 'chatgpt-codex' ? connectCodex : connectACP)(options);
      return { ...session, prompt: async text => { try { return await session.prompt(text); } catch (error) { return capture(error); } } };
    } catch (error) { return capture(error); }
  }); runtime.language = 'zh-Hans';
  runtime.connections.set(provider, { ...connection, enabled: true }); runtime.select(provider);
  const wait = async id => {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const job = runtime.data.job(id);
      if (!runtime.active.size && !['queued', 'running'].includes(job?.state)) return job;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Native evaluation exceeded 180 seconds.');
  };
  const count = table => Number(store.query(`SELECT count(*) AS n FROM ${table}`)[0].n);
  const seed = () => {
    store.mutate('goal', 'create', 'growth', { requestID: randomUUID(), title: '教程试用', milestone: '2026 年底有 10 家商家完成试用', symbol: 'Target' });
    store.mutate('strategy', 'create', 'research', { requestID: randomUUID(), goalID: 'growth', title: '验证教程需求', body: '研究商家需求，准备可验证的教程体验方案', origin: '用户已选择' });
  };
  let jobID;
  try {
    if (name === 'initial_strategies') {
      store.mutate('goal', 'create', 'growth', { requestID: randomUUID(), title: '家具教程试用', milestone: '2026 年底有 10 家真实商家完成试用', symbol: 'Target' });
      jobID = runtime.send('这是首次规划这个目标，还没有策略。我们做浏览器里的家具安装教程，团队两人，每周能投入十小时，没有广告预算，也没有真实试用商家。已知资源是一些认识的家具商家、可以分享制作经验的行业社区和一个可演示的教程样例。请先基于这些已知事实帮我规划推进方向，候选方案由我来选。');
    } else if (name === 'strategy_breadth') {
      seed();
      // This existing strategy has finished its initial decision research.
      store.query("INSERT INTO metadata(key,value) VALUES('strategy_auto_advance:research','prepared')");
      jobID = runtime.send('我们已经采用“验证教程需求”这一条策略。目前团队两人，每周能投入十小时，没有广告预算，还没有真实试用商家。请结合已有目标继续完善推进方向。');
    } else if (name === 'automatic_language') {
      runtime.language = 'en';
      store.mutate('goal', 'create', 'language-goal', { requestID: randomUUID(), title: '选择首批教程试用用户', milestone: '选定一组用户，验证安装教程是否清楚', symbol: 'Target' });
      store.mutate('strategy', 'create', 'language-strategy', { requestID: randomUUID(), goalID: 'language-goal', title: '从已有用户中开展试用',
        body: '用户已提供的事实：五位首次组装家具的买家和五位熟练安装师傅都已同意试用。团队本周只能服务一组。前者能暴露基础说明问题，后者能检查步骤准确性。两组同样方便联系、费用相同。用户保留首批人群的最终选择权，尚未决定。', origin: '用户已选择' });
      runtime.pump();
      jobID = store.query("SELECT id FROM agent_job WHERE origin='auto_advance'")[0].id;
    } else if (name.startsWith('task_')) {
      seed();
      const request = name === 'task_question'
        ? '帮我评估产品页面的清晰度。产品尚未公开，我还没有提供产品页面链接，现有资料也没有；先向我取得链接再评估。'
        : '写两种家具教程欢迎语，一种正式一种轻松。我保留最终语气的选择权，请把这个选择交给我；内容只保存在 Polaris，不发出。';
      const work = runtime.data.createWork('research', name, request);
      jobID = runtime.queueWork(request, work.id, provider); runtime.pump();
    } else {
      if (name.startsWith('planning_')) {
        const previous = runtime.data.send('家具教程目前没有真实商家使用，你有什么推荐的目标吗？');
        store.query('UPDATE agent_job SET provider=? WHERE id=?', provider === 'chatgpt-codex' ? 'gemini-cli' : 'chatgpt-codex', previous);
        runtime.data.message(previous, '建议目标：验证家具教程在真实买家组装时能否提供帮助。验收是：一家商家把一款商品的教程交给真实买家，至少一位买家实际使用并指出它解决了哪个安装问题。这是目标草案，原则和策略还没有选定。', 'completed');
        runtime.data.setJob(previous, 'completed');
      }
      if (['capabilities', 'project_intro'].includes(name)) {
        const previous = await wait(runtime.send(`理解本机的 ${project} 项目。`));
        assert.equal(previous.state, 'completed', `Project understanding failed: ${previous.error}`);
      }
      const requests = {
        understand: `理解本机的 ${project} 项目。`,
        discuss: '我们的产品是给家具商家制作浏览器组装教程，目前没有付费客户，团队两个人、预算每月两千元。讨论一下直接联系商家和在行业社区发内容两条获客路径的优劣，现在先分析。',
        create: '我已决定：创建目标“家具教程试用”，验收是 2026 年底有 10 家真实商家完成试用；采用原则“仅统计真实商家”，采用策略“邀请现有商家试用”，方法是邀请已有联系渠道的商家体验并收集反馈。把这些保存到 Polaris，策略在 2099 年 1 月 1 日上午 9 点（台北时间）执行一次。',
        knowledge: '记住这条项目资料：项目叫“家具教程”，用途是让买家在浏览器逐步查看家具安装步骤，当前没有支付功能。来源是我在这条消息中提供的产品信息。保存到资料库，之后会复用。',
        capabilities: '你可以干什么？',
        project_intro: '这个是我的项目',
        personal_goal: '我今年想把英语口语练到能应付外企面试，但不知道从哪开始。',
        goal_discovery: '我想让家具教程真正帮到商家，但还没想清楚目标。目前产品只能在浏览器展示安装步骤，团队两人，还没有真实商家使用。帮我一起梳理目标和可尝试的策略，先给候选方案和建议，我还没选定。',
        planning_continue: '可以，就定这个目标吧。',
        planning_stop: '可以，就定这个目标吧。只保存目标，今天先到这里，不用继续讨论。',
      };
      jobID = runtime.send(requests[name]);
    }
    let job = await wait(jobID);
    assert.equal(job.state, 'completed', `Unexpected state ${job.state}: ${job.error}`);
    if (name === 'initial_strategies') {
      assert.equal(count('goal'), 1);
      for (const table of ['strategy', 'decision', 'agent_work', 'scheduled_task']) assert.equal(count(table), 0, 'Initial recommendations must wait for adoption.');
      const reply = store.query('SELECT body FROM agent_message WHERE id=?', `${jobID}:assistant`)[0]?.body ?? '';
      console.log(JSON.stringify({ name, reply }));
    }
    if (name === 'strategy_breadth') {
      const reply = () => store.query('SELECT body FROM agent_message WHERE id=?', `${jobID}:assistant`)[0]?.body ?? '';
      assert.equal(count('goal'), 1);
      assert.equal(count('strategy'), 1, 'Candidate strategies must wait for adoption.');
      assert.equal(count('scheduled_task'), 0);
      assert.equal(count('agent_work'), 0);
      console.log(JSON.stringify({ name, phase: 'recommend', reply: reply() }));
      jobID = runtime.send('这周我决定只保留现有这一条策略，先集中验证教程需求。今天到这里，不用继续推荐其他方向。');
      job = await wait(jobID);
      assert.equal(job.state, 'completed');
      assert.equal(count('strategy'), 1);
      assert.equal(count('scheduled_task'), 0);
      assert.equal(count('agent_work'), 0);
      console.log(JSON.stringify({ name, phase: 'focus', reply: reply() }));
    }
    if (name === 'automatic_language') {
      const cards = store.snapshot().decisions;
      assert.ok(cards.length >= 1 && cards.length <= 3);
      for (const card of cards) {
        for (const text of [card.title, card.body, ...card.options.flatMap(option => [option.label, option.detail].filter(Boolean))])
          assert.match(text, /\p{Script=Han}/u, 'Chinese business context must produce Chinese card text despite English internal instructions and interface language.');
      }
      assert.equal(count('scheduled_task'), 0);
      console.log(JSON.stringify({ name, cards: cards.map(({ title, body, options }) => ({ title, body, options })) }));
    }
    if (name.startsWith('planning_')) {
      assert.equal(count('goal'), 1);
      for (const table of ['strategy', 'decision', 'agent_work', 'scheduled_task']) assert.equal(count(table), 0, 'Accepting a goal does not adopt unchosen planning or authorize execution.');
      const reply = store.query('SELECT body FROM agent_message WHERE id=?', `${jobID}:assistant`)[0]?.body ?? '';
      console.log(JSON.stringify({ name, reply }));
      if (name === 'planning_continue') {
        // A concrete question about pilot access is strategy guidance even without the word "strategy".
        assert.match(reply, /商家|买家|预算|限制|渠道|联系|样本|隐私|资料/);
        assert.match(reply, /约束|原则|偏好|时间|预算|限制|风险|边界/, 'After a goal is adopted, guide the constraints that shape strategy choice.');
        assert.match(reply, /建议|优先|方案|尝试|选择|[？?]/, 'Recommend constraints or ask one concrete question about them.');
        assert.doesNotMatch(reply, /^(要不要|是否|需不需要)(继续|我继续)/, 'Guide a concrete planning choice instead of asking permission to keep collaborating.');
        const goalID = store.snapshot().goals[0].id;
        const next = runtime.send('原则采用“仅统计真实买家的实际使用”；策略采用“从已有商家开始试用”，先请已有联系渠道的商家提供一款商品资料，交给真实买家体验并收集反馈。把这一版原则和策略保存下来，先不开始执行。');
        job = await wait(next);
        assert.equal(job.state, 'completed');
        assert.equal(count('goal'), 1); assert.equal(store.snapshot().goals[0].id, goalID);
        assert.ok(store.snapshot().goals[0].constraints.length); assert.equal(count('strategy'), 1); assert.equal(count('agent_work'), 0); assert.equal(count('scheduled_task'), 0);
        job = await wait(runtime.send('安排在 2099 年 1 月 1 日上午 9 点（台北时间）执行一次，按刚才确定的策略保存。'));
        assert.equal(job.state, 'completed'); assert.equal(count('strategy'), 1); assert.equal(count('scheduled_task'), 1);
        const strategy = store.snapshot().strategies[0];
        const change = '把刚才那条策略调整为只邀请已有合作的家具商家，暂不找陌生商家。目标和原则沿用，只更新现有策略，今天先到这里。';
        const updated = runtime.send(change);
        job = await wait(updated); assert.equal(job.state, 'completed');
        assert.equal(count('strategy'), 1); assert.equal(store.snapshot().strategies[0].id, strategy.id);
        assert.ok(store.snapshot().strategies[0].version > strategy.version);
        assert.match(store.snapshot().strategies[0].title + store.snapshot().strategies[0].body, /合作/);
        assert.equal(count('goal'), 1); assert.ok(store.snapshot().goals[0].constraints.length); assert.equal(count('agent_work'), 0);
      }
    }
    if (['capabilities', 'project_intro', 'personal_goal', 'goal_discovery'].includes(name)) {
      const message = store.query('SELECT body,parts FROM agent_message WHERE id=?', `${jobID}:assistant`)[0];
      const parts = JSON.parse(message.parts);
      const reply = parts.filter(part => part.type === 'text' && part.phase === 'final_answer').map(part => part.text).join('\n') || message.body;
      console.log(JSON.stringify({ name, reply }));
      assert.match(reply, /目标/);
      for (const table of ['goal', 'strategy', 'decision', 'agent_work', 'scheduled_task']) assert.equal(count(table), 0, 'Draft planning is not adoption or execution.');
      if (name !== 'goal_discovery') {
        // Without an adopted goal, the main Agent leads toward one instead of only answering.
        assert.match(reply, /建议|推荐|倾向/, 'Recommend a candidate goal.');
        assert.match(reply, /[？?]/, 'End with a concrete question that moves goal clarification forward.');
      }
      if (name === 'personal_goal') assert.match(reply, /口语|面试/, 'Candidate goals stay in the user\'s own domain.');
      if (['capabilities', 'goal_discovery'].includes(name)) assert.match(reply, /策略|路径/);
      if (name === 'capabilities') {
        assert.equal(job.state, 'completed', 'Explaining Polaris completes the turn; the closing question stays in chat.');
        assert.match(reply, /决策卡|卡片/); assert.match(reply, /执行|落地|实施/);
        const coding = reply.search(/改代码|写代码|修复|修问题|编程|跑测试|审查代码/);
        assert.ok(coding < 0 || (reply.indexOf('目标') < coding && reply.search(/策略|路径/) < coding), 'Polaris introduces goals and strategy before native coding capabilities.');
        const calls = parts.flatMap(part => part.type === 'activity' ? part.calls : []);
        assert.ok(!calls.some(call => (call.input || '').includes('openai-docs/SKILL.md')), 'A question about Polaris should not be routed to Codex product documentation.');
      }
    }
    if (['understand', 'discuss', 'knowledge'].includes(name)) {
      for (const table of ['goal', 'strategy', 'decision', 'agent_work', 'scheduled_task']) assert.equal(count(table), 0, `${name} must not create ${table}`);
      assert.equal(job.state, 'completed', 'Enough information was provided for this request.');
    }
    if (name === 'understand') {
      assert.equal(await readFile(path.join(project, 'README.md'), 'utf8'), readme);
      const reply = runtime.conversation().messages.filter(m => m.role === 'assistant').map(m => m.body).join('\n');
      assert.match(reply, /家具|安装/); assert.match(reply, /浏览器|HTML|步骤/);
    }
    if (name === 'knowledge') { assert.equal(count('knowledge'), 1); assert.equal(count('knowledge_goal'), 0); }
    if (name === 'create') {
      assert.equal(job.state, 'completed');
      for (const table of ['goal', 'strategy']) assert.equal(count(table), 1, `Explicit creation must save ${table}`);
      // Saved strategies prepare decision cards automatically; the main Agent itself submits none and starts no work.
      const automatic = "SELECT id FROM agent_job WHERE origin='auto_advance'";
      assert.equal(Number(store.query(`SELECT count(*) AS n FROM decision_source WHERE sourceJobID NOT IN (${automatic})`)[0].n), 0);
      assert.equal(Number(store.query(`SELECT count(*) AS n FROM agent_work WHERE id NOT IN (SELECT workID FROM agent_job WHERE origin='auto_advance')`)[0].n), 0);
      assert.equal(count('scheduled_task'), 1, 'The explicitly requested one-time run is saved as a scheduled task.');
    }
    if (name === 'task_question') {
      assert.equal(count('decision'), 1);
      const card = store.snapshot().decisions[0];
      assert.deepEqual(card.options, []);
      assert.match(card.title + card.body, /链接|网址|URL/i);
      assert.equal(card.outcome, undefined);
      const source = job;
      const outcome = store.decide(card.id, undefined, `产品说明在本机 ${project}/README.md，请据此评价，不访问网页。`, card.version);
      const answerID = store.query('SELECT id FROM agent_job WHERE outcomeID=?', outcome.id)[0].id;
      job = await wait(answerID);
      assert.equal(job.state, 'completed');
      assert.notEqual(job.sessionKey, source.sessionKey);
      assert.equal(count('decision'), 1); assert.equal(count('agent_work'), 2);
    }
    if (name === 'task_decision') {
      assert.equal(job.state, 'completed'); assert.equal(count('decision'), 1);
      const card = store.snapshot().decisions[0]; assert.ok(card.options.length >= 2); assert.equal(card.outcome, undefined);
    }
    const prompts = store.query(`SELECT e.jobID,e.createdAt AS sentAt,e.payload,m.parts FROM agent_run_event e
      LEFT JOIN agent_message m ON m.id=e.jobID||':assistant' WHERE e.type='prompt' ORDER BY e.seq`).map(row => {
      const { bytes, contextBytes } = JSON.parse(row.payload);
      const first = JSON.parse(row.parts ?? '[]').find(part => part.type === 'text' && part.text.trim());
      const firstTextMs = first?.receivedAt ? Date.parse(first.receivedAt) - Date.parse(row.sentAt) : null;
      const usage = store.query("SELECT payload FROM agent_native_event WHERE jobID=? AND json_extract(payload,'$.type')='usage' ORDER BY rowid DESC LIMIT 1", row.jobID)[0];
      return { bytes, contextBytes, firstTextMs, usage: usage ? JSON.parse(usage.payload).data : null };
    });
    results.push({ name, trial, pass: true, prompts }); console.log(`PASS ${name} ${trial}`);
  } catch (error) {
    results.push({ name, trial, pass: false, error: error.message, protocolError }); console.log(`FAIL ${name} ${trial}: ${error.message}${protocolError ? ` (${protocolError})` : ''}`);
  } finally { await runtime.stop(); store.close(); await rm(dir, { recursive: true, force: true }); }
}
console.log(JSON.stringify(results, null, 2));
assert.ok(results.every(result => result.pass), 'Native prompt behavior regression failed.');
