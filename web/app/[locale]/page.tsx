import { Activity, ArrowRight, BookOpen, CalendarClock, ChevronRight, History, Lightbulb, MessageSquareText, Plus, RotateCcw } from 'lucide-react';
import desktop from '../../../desktop/package.json';
import { getT } from '../../i18n';
import clients from '../clients.json';
import { links } from '../links';
import { CopyButton } from './CopyButton';
import { Board, Chat, DecisionDialog, LaneView, type Goal } from './mocks';

const commands = 'git clone https://github.com/xmili233/polaris.git\ncd polaris\n./macos/scripts/build-app.sh\nopen macos/build/Polaris.app';

export default async function Home() {
  const { t, lng } = await getT();
  const relative = new Intl.RelativeTimeFormat(lng, { numeric: 'always' });
  const minutes = (value: number) => relative.format(-value, 'minute');
  const hours = (value: number) => relative.format(-value, 'hour');
  const board = { constraints: t('goal.constraints') };
  const dialog = { recommended: t('board.recommended'), or: t('board.or'), custom: t('board.writeYourOwnDecision'), help: t('execution.confirmationHelp'), decide: t('board.decide') };

  const lanes = {
    conversations: { title: t('web.demo.conversations'), body: t('web.demo.conversationsBody') },
    public: { title: t('web.demo.public'), body: t('web.demo.publicBody') },
    offer: { title: t('web.demo.offer'), body: t('web.demo.offerBody') },
  };
  const customers: Goal = {
    title: t('web.demo.goalCustomers'), milestone: t('web.demo.milestoneCustomers'),
    constraints: [t('web.demo.noAds'), t('web.demo.realConversations')],
    lanes: [
      { ...lanes.conversations, cards: [
        { title: t('web.demo.audience'), body: t('web.demo.audienceBody'), ago: minutes(48) },
        { title: t('web.demo.problem'), body: t('web.demo.problemBody'), ago: minutes(35) },
        { title: t('web.demo.invitation'), body: t('web.demo.invitationBody'), ago: minutes(21) },
      ] },
      { ...lanes.public, cards: [
        { title: t('web.demo.angle'), body: t('web.demo.angleBody'), ago: minutes(44) },
        { title: t('web.demo.demo'), body: t('web.demo.demoBody'), ago: minutes(31) },
        { title: t('web.demo.teaser'), body: t('web.demo.teaserBody'), ago: minutes(17) },
      ] },
      { ...lanes.offer, cards: [
        { title: t('web.demo.promise'), body: t('web.demo.promiseBody'), ago: minutes(52) },
        { title: t('web.demo.access'), body: t('web.demo.accessBody'), ago: minutes(39) },
        { title: t('web.demo.intent'), body: t('web.demo.intentBody'), ago: minutes(12) },
      ] },
    ],
  };
  const language: Goal = {
    title: t('web.demo.goalLanguage'), milestone: t('web.demo.milestoneLanguage'),
    constraints: [t('web.demo.weekdays'), t('web.demo.speakMore')],
    lanes: [
      { title: t('web.demo.speaking'), body: t('web.demo.speakingBody'), cards: [
        { title: t('web.demo.morning'), body: t('web.demo.morningBody'), ago: hours(2) },
        { title: t('web.demo.topics'), body: t('web.demo.topicsBody'), ago: minutes(40) },
      ] },
      { title: t('web.demo.tutor'), body: t('web.demo.tutorBody'), cards: [
        { title: t('web.demo.tutorPick'), body: t('web.demo.tutorPickBody'), ago: hours(1) },
      ] },
      { title: t('web.demo.listening'), body: t('web.demo.listeningBody'), cards: [
        { title: t('web.demo.commute'), body: t('web.demo.commuteBody'), ago: minutes(18) },
      ] },
    ],
  };
  const marathon: Goal = {
    title: t('web.demo.goalMarathon'), milestone: t('web.demo.milestoneMarathon'),
    constraints: [t('web.demo.fourDays'), t('web.demo.knees')],
    lanes: [
      { title: t('web.demo.mileage'), body: t('web.demo.mileageBody'), cards: [
        { title: t('web.demo.plan'), body: t('web.demo.planBody'), ago: hours(3) },
        { title: t('web.demo.longRun'), body: t('web.demo.longRunBody'), ago: hours(2) },
      ] },
      { title: t('web.demo.strength'), body: t('web.demo.strengthBody'), cards: [
        { title: t('web.demo.routine'), body: t('web.demo.routineBody'), ago: hours(2) },
      ] },
      { title: t('web.demo.raceDay'), body: t('web.demo.raceDayBody'), cards: [
        { title: t('web.demo.register'), body: t('web.demo.registerBody'), ago: minutes(50) },
        { title: t('web.demo.shoes'), body: t('web.demo.shoesBody'), ago: minutes(25) },
      ] },
    ],
  };
  const communities = { title: t('web.demo.communities'), body: t('web.demo.communitiesBody'), cards: [
    { title: t('web.demo.community'), body: t('web.demo.communityBody'), ago: minutes(1) },
    { title: t('web.demo.lead'), body: t('web.demo.leadBody'), ago: minutes(1) },
    { title: t('web.demo.intro'), body: t('web.demo.introBody'), ago: minutes(1) },
  ] };
  const badges = [9, 4, 5];
  // The primary button downloads the Apple silicon build; browsers cannot tell Apple silicon from Intel, so Intel is offered by name.
  const downloadMeta = <p className="download-meta">{t('web.download.requirements')}<span aria-hidden="true"> · </span><a href={links.download.x64}>{t('web.download.intel')}</a></p>;

  return <>
    <section className="hero">
      <div className="wrap">
        <h1>{t('web.hero.title')}</h1>
        <p className="hero-body">{t('web.hero.body')}</p>
        <p className="actions">
          <a className="button" href={links.download.arm64}>{t('web.download.mac')}</a>
          <a className="text-link" href={links.repository}>{t('web.hero.github')}<ChevronRight aria-hidden="true" /></a>
        </p>
        {downloadMeta}
      </div>
      <div className="wrap">
        <div className="hero-view" aria-hidden="true"><Board goal={customers} selected={0} badges={badges} labels={board} /></div>
      </div>
    </section>

    <section className="clients">
      <div className="wrap">
        <p className="clients-copy"><strong>{t('web.agents.title')}</strong><br />{t('web.agents.body')}</p>
        <ul className="clients-list"><li>Codex</li><li>Claude Code</li><li>Gemini CLI</li></ul>
      </div>
    </section>

    <section className="band" id="decide">
      <div className="wrap">
        <h2>{t('web.decide.title')}</h2>
        <p className="lead"><strong>{t('web.decide.lead')}</strong> {t('web.decide.body')}</p>
      </div>
      <div className="wrap view decide-view" aria-hidden="true">
        <div className="decide-backdrop"><Board goal={customers} selected={0} badges={badges} labels={board} /></div>
        <div className="decide-dialog">
          <DecisionDialog strategy={lanes.conversations.title} title={t('web.demo.audience')} ago={minutes(48)} labels={dialog}
            options={[{ label: t('web.demo.solo'), detail: t('web.demo.soloDetail'), recommended: true }, { label: t('web.demo.teams'), detail: t('web.demo.teamsDetail') }]}>
            <p>{t('web.demo.audienceBody')}</p>
            <p>{t('web.demo.audienceWeek')}</p>
            <ul><li>{t('web.demo.audienceSolo')}</li><li>{t('web.demo.audienceTeams')}</li></ul>
            <p>{t('web.demo.audienceClose')}</p>
          </DecisionDialog>
        </div>
      </div>
      <div className="wrap">
        <ul className="features">
          <li><MessageSquareText aria-hidden="true" /><h3>{t('web.decide.oneTitle')}</h3><p>{t('web.decide.oneBody')}</p></li>
          <li><Lightbulb aria-hidden="true" /><h3>{t('web.decide.recTitle')}</h3><p>{t('web.decide.recBody')}</p></li>
          <li><ArrowRight aria-hidden="true" /><h3>{t('web.decide.handoffTitle')}</h3><p>{t('web.decide.handoffBody')}</p></li>
          <li><History aria-hidden="true" /><h3>{t('web.decide.historyTitle')}</h3><p>{t('web.decide.historyBody')}</p></li>
        </ul>
      </div>
    </section>

    <section className="band" id="plan">
      <div className="wrap">
        <h2>{t('web.plan.title')}</h2>
        <p className="lead"><strong>{t('web.plan.lead')}</strong> {t('web.plan.body')}</p>
      </div>
      <div className="wrap view chat-view" aria-hidden="true">
        <Chat user={t('web.demo.chatUser')} intro={t('web.demo.chatGoal')} next={t('web.demo.chatNext')} placeholder={t('agent.onboardingPlaceholder')}
          strategies={[lanes.conversations, lanes.public, lanes.offer]} />
      </div>
      <div className="wrap">
        <div className="split">
          <article>
            <h3>{t('web.plan.growTitle')}</h3>
            <p>{t('web.plan.growBody')}</p>
            <div className="split-view suggest-view" aria-hidden="true">
              <DecisionDialog strategy={lanes.conversations.title} title={t('web.demo.suggestTitle')} ago={minutes(1)} labels={dialog}
                options={[{ label: t('web.demo.suggestAdd'), detail: t('web.demo.communitiesBody'), recommended: true }, { label: t('web.demo.suggestLater'), detail: t('web.demo.suggestLaterDetail') }]}>
                <p>{t('web.demo.suggestStudy')}</p>
                <ul><li>{t('web.demo.suggestFound')}</li><li>{t('web.demo.suggestWorked')}</li></ul>
                <p>{t('web.demo.suggestFirst')}</p>
              </DecisionDialog>
            </div>
          </article>
          <article>
            <h3>{t('web.plan.prepareTitle')}</h3>
            <p>{t('web.plan.prepareBody')}</p>
            <div className="split-view prepare-view" aria-hidden="true">
              <div className="pm"><LaneView lane={communities} preparing={t('loop.preparingDecisions')} className="arriving" /></div>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section className="band" id="goals">
      <div className="wrap">
        <h2>{t('web.parallel.title')}</h2>
        <p className="lead"><strong>{t('web.parallel.lead')}</strong> {t('web.parallel.body')}</p>
      </div>
      <div className="wrap"><div className="stack-view" aria-hidden="true">
        <div className="stack">
          <div className="stack-board"><Board goal={customers} selected={0} badges={badges} labels={board} running={[0, 1]} /></div>
          <div className="stack-board"><Board goal={language} selected={1} badges={badges} labels={board} running={[2]} /></div>
          <div className="stack-board"><Board goal={marathon} selected={2} badges={badges} labels={board} running={[3, 4]} /></div>
        </div>
      </div></div>
      <div className="wrap">
        <ul className="features">
          <li><Activity aria-hidden="true" /><h3>{t('web.parallel.activityTitle')}</h3><p>{t('web.parallel.activityBody')}</p></li>
          <li><CalendarClock aria-hidden="true" /><h3>{t('web.parallel.scheduleTitle')}</h3><p>{t('web.parallel.scheduleBody')}</p></li>
          <li><RotateCcw aria-hidden="true" /><h3>{t('web.parallel.recoveryTitle')}</h3><p>{t('web.parallel.recoveryBody')}</p></li>
          <li><BookOpen aria-hidden="true" /><h3>{t('web.parallel.knowledgeTitle')}</h3><p>{t('web.parallel.knowledgeBody')}</p></li>
        </ul>
      </div>
    </section>

    <section className="band" id="local">
      <div className="wrap">
        <h2>{t('web.local.title')}</h2>
        <p className="lead"><strong>{t('web.local.lead')}</strong> {t('web.local.body')}</p>
        <div className="split split-text">
          <article><h3>{t('web.local.providerTitle')}</h3><p>{t('web.local.providerBody')}</p></article>
          <article>
            <h3>{t('web.local.boundaryTitle')}</h3><p>{t('web.local.boundaryBody')}</p>
            <a className="text-link" href={links.boundaries}>{t('web.local.boundaryLink')}<ChevronRight aria-hidden="true" /></a>
          </article>
        </div>
      </div>
    </section>

    <section className="band" id="faq">
      <div className="wrap faq">
        <h2>{t('web.faq.title')}</h2>
        <div className="faq-list">
          <details open><summary>{t('web.faq.freeQ')}<Plus aria-hidden="true" /></summary><p>{t('web.faq.freeA')}</p></details>
          <details><summary>{t('web.faq.versionQ')}<Plus aria-hidden="true" /></summary><p>{t('web.faq.versionA', { version: desktop.version })}</p></details>
          <details><summary>{t('web.faq.trustQ')}<Plus aria-hidden="true" /></summary><p>{t('web.faq.trustA')}</p></details>
          <details>
            <summary>{t('web.faq.clientsQ')}<Plus aria-hidden="true" /></summary>
            <p>{t('web.faq.clientsA')}</p>
            <dl className="faq-clients">{clients.map(client => <div key={client.id}>
              <dt>{client.label}</dt><dd>{client.minimum ? t('web.faq.orLater', { version: client.minimum }) : `${client.line}.x`}</dd>
            </div>)}</dl>
          </details>
          <details><summary>{t('web.faq.platformQ')}<Plus aria-hidden="true" /></summary><p>{t('web.faq.platformA')}</p></details>
          <details><summary>{t('web.faq.updateQ')}<Plus aria-hidden="true" /></summary><p>{t('web.faq.updateA')}</p></details>
          <details><summary>{t('web.faq.closedQ')}<Plus aria-hidden="true" /></summary><p>{t('web.faq.closedA')}</p></details>
        </div>
      </div>
    </section>

    <section className="band start" id="start">
      <div className="wrap start-grid">
        <div>
          <h2>{t('web.start.title')}</h2>
          <p className="lead">{t('web.start.body')}</p>
          <p className="actions">
            <a className="button" href={links.download.arm64}>{t('web.download.mac')}</a>
            <a className="text-link" href={links.guide}>{t('web.start.guide')}<ChevronRight aria-hidden="true" /></a>
          </p>
          {downloadMeta}
        </div>
        <div className="terminal">
          <p className="terminal-caption">{t('web.start.source')}</p>
          <pre><code>{commands}</code></pre>
          <CopyButton text={commands} label={t('web.start.copy')} done={t('web.start.copied')} />
        </div>
      </div>
    </section>
  </>;
}
