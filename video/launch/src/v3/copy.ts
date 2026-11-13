import type {Locale} from './kit';

// Per-language film text. Tool activity lines stay in English, as in the product (R-D66).
// {{id|text}} marks a question that becomes the card with that id; the text matches the card title.
export type Who = 'conversations' | 'public' | 'offer';
export type Block = {who: Who; tool?: string; text: string};
type Copy = {strategies: Record<Who, string>; added: string; blocks: Block[]; captions: string[]; end: [string, string]};

const tools = {
  offerPages: 'Opened 5 early-access pages  ·  Compared pricing tables',
  replies: 'Read 23 replies  ·  Tagged 9 recurring questions',
  waitlist: 'Read waitlist.csv  ·  Searched 38 community threads  ·  Wrote drafts/invite.md',
  landing: 'Edited landing/hero.md  ·  Ran 4 commands',
  thread: 'Created drafts/thread-1.md  ·  Recorded 2 screen clips',
  interviews: 'Read interviews/2026-11-05.md  ·  Read interviews/2026-11-07.md',
  onboarding: 'Wrote notes/onboarding.md',
  followup: 'Updated drafts/followup.md',
  schedule: 'Updated notes/interviews.md  ·  Scheduled 2 reminders',
  changelogs: 'Read 6 competitor changelogs',
};

export const COPY: Record<Locale, Copy> = {
  en: {
    strategies: {conversations: 'Customer conversations', public: 'Build in public', offer: 'Validate the offer'},
    added: 'Founder communities',
    blocks: [
      {who: 'offer', tool: tools.offerPages, text: 'I summarized what each early-access page includes, how long the trial lasts, and what support comes with it. The comparison table is in notes/offer.md.'},
      {who: 'public', tool: tools.replies, text: 'Most replies under the last post asked how the agents keep working between check-ins. I grouped them by topic and saved the strongest examples.'},
      {who: 'conversations', tool: tools.waitlist, text: 'I shortlisted 14 founders from the waitlist and drafted the interview invite. {{audience|Who should we interview first?}} Solo founders reply faster, but small teams show where shared decisions slow down. {{invitation|Is this interview invitation ready to send?}} I also grouped last week’s notes into two recurring pains. {{problem|Which problem should we explore first?}}'},
      {who: 'offer', tool: tools.landing, text: 'The landing page test is set up with two headlines, and the second variant kept people on the page 18% longer in a small sample. {{promise|Which promise should lead the landing page?}} I also drafted three early-access packages. {{access|What should early access include?}}'},
      {who: 'public', tool: tools.thread, text: 'For the build-in-public thread, I drafted three openings and recorded two short demo clips. {{angle|Which angle should our first post lead with?}} The clips show different moments of the product. {{demo|Which product moment should the demo show?}} The teaser draft and footage are in the shared folder. {{teaser|Is this launch teaser ready to publish?}}'},
      {who: 'conversations', tool: tools.interviews, text: 'Three people mentioned too much back-and-forth with their agents, and two said the choices were hard to compare. {{feedback|Which feedback should we validate next?}} I will keep collecting replies in the meantime.'},
      {who: 'offer', tool: tools.onboarding, text: 'Our strongest replies came from independent builders, but small teams asked better questions. {{onboarding|Who should onboarding focus on?}} Before we compare any results, we should agree on one thing. {{intent|What should count as buying intent?}}'},
      {who: 'public', tool: tools.followup, text: 'A few readers asked how decisions come back to the user, and that thread is still growing. {{followup|Which reader question needs a follow-up?}}'},
      {who: 'conversations', tool: tools.schedule, text: 'Two founders on the shortlist are only free this Thursday. I have kept everything else on schedule and will report back once the first interviews are done.'},
      {who: 'offer', tool: tools.changelogs, text: 'None of the comparable products offers a guided first goal yet. I noted the closest alternatives and what they charge.'},
    ],
    captions: ['Decisions get buried in the text.', 'Agents keep the work. You get the decisions.', 'One question. Clear options. Your call.',
      'Any goal. Many strategies. All at once.', 'Agents study what worked for goals like yours.', 'New strategy paths. Say yes, and work begins.', 'You focus on goals and strategy.'],
    // Business data is stored on the Mac; agents still use the chosen platform's models, so the film does not claim data never leaves.
    end: ['Free and open source.', 'Your data is stored on your Mac.'],
  },
  'zh-Hans': {
    strategies: {conversations: '客户访谈', public: '公开构建', offer: '验证方案'},
    added: '创始人社区',
    blocks: [
      {who: 'offer', tool: tools.offerPages, text: '我整理了五个早期体验页面各自包含的内容、试用时长和配套支持。对比表放在 notes/offer.md。'},
      {who: 'public', tool: tools.replies, text: '上一篇帖子下的回复，大多在问 Agent 如何在两次查看之间持续工作。我按主题做了归类，并保存了最有代表性的例子。'},
      {who: 'conversations', tool: tools.waitlist, text: '我从候补名单里筛出 14 位创始人，并起草了访谈邀请。{{audience|先访谈哪类人？}}独立创始人回复更快，但小团队更能暴露共同决策中的卡点。{{invitation|这封访谈邀请可以发出了吗？}}我还把上周的记录归纳成两个反复出现的痛点。{{problem|先深挖哪个问题？}}'},
      {who: 'offer', tool: tools.landing, text: '落地页测试已经准备好两个标题，小样本里第二版让用户多停留了 18%。{{promise|落地页主打哪个承诺？}}我还起草了三种早期体验方案。{{access|早期体验包含什么？}}'},
      {who: 'public', tool: tools.thread, text: '公开构建的帖子，我写了三个开头，录了两段演示短片。{{angle|第一篇帖子用哪个切入点？}}两段短片展示的是产品的不同时刻。{{demo|演示展示哪个产品时刻？}}预告文案和素材都在共享文件夹里。{{teaser|这条预告可以发布了吗？}}'},
      {who: 'conversations', tool: tools.interviews, text: '有三个人提到和 Agent 来回沟通太多，两个人说选项难以比较。{{feedback|下一步验证哪条反馈？}}这期间我会继续收集回复。'},
      {who: 'offer', tool: tools.onboarding, text: '回复最积极的是独立开发者，但小团队提的问题更有价值。{{onboarding|新手引导聚焦哪类用户？}}比较结果之前，我们需要先约定一件事。{{intent|什么算作购买意向？}}'},
      {who: 'public', tool: tools.followup, text: '有几位读者问决策怎样回到用户手中，这个话题的讨论还在增加。{{followup|要跟进哪个读者问题？}}'},
      {who: 'conversations', tool: tools.schedule, text: '名单上有两位创始人只有周四有空。其他安排都照常推进，第一批访谈结束后我再汇报。'},
      {who: 'offer', tool: tools.changelogs, text: '同类产品里还没有提供带引导的第一个目标。我记录了最接近的几个替代方案和它们的价格。'},
    ],
    captions: ['决策埋在大段文字里。', '工作留给 Agent，决策交给你。', '一个问题，选项清楚，由你决定。',
      '任何目标，多条策略，同时推进。', '围绕你的目标，Agent 研究成功案例。', '找到新的策略路径，你点头就开始推进。', '你只需专注目标和策略。'],
    end: ['免费开源。', '数据存储在你的 Mac 上。'],
  },
};
