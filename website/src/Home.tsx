import { homeZhCN, type HomeMessage } from './i18n';
import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  Check,
  CheckCheck,
  Code2,
  FileText,
  FolderGit2,
  GitBranch,
  Globe2,
  MessageSquare,
  Monitor,
  Network,
  Server,
  ShieldCheck,
  Terminal,
} from 'lucide-react';

const channels = [
  {
    icon: Monitor,
    title: 'Steer Web',
    copy: 'Send a message or image, follow progress, and view the results beside your conversation.',
    href: '/fusion',
    label: 'Open workspace',
  },
  {
    icon: MessageSquare,
    title: 'Feishu bot',
    copy: 'Connect a bot in Settings. Switch projects in chat, follow up in the same thread, and use /status to check progress.',
    href: 'https://github.com/KDF5000/steer/blob/main/docs/feishu-integration.md',
    label: 'Explore the Feishu integration',
  },
  {
    icon: Code2,
    title: 'Conversation Task API',
    copy: 'Connect your app or workflow. Start or continue a conversation, stream progress, download results, and cancel tasks.',
    href: 'https://github.com/KDF5000/steer/blob/main/docs/task-api.md',
    label: 'Read the API docs',
  },
] as const;

function Brand({ label, locale }: { label: string; locale: Locale }) {
  return (
    <a className="website_brand" href={`/${locale}/`} aria-label={label}>
      <img src="/favicon.svg" width={30} height={30} alt="" />
      <span>Steer</span>
    </a>
  );
}

export type Locale = 'zh' | 'en';

export default function HomeContent({
  locale,
  appUrl,
}: {
  locale: Locale;
  appUrl: string;
}) {
  const language = locale === 'zh' ? 'zh-CN' : 'en';
  const screenshot =
    locale === 'zh' ? '/steer-workspace-zh' : '/steer-workspace';
  const handoffScreenshot = `/steer-handoff-${locale}.png`;
  const t = (key: HomeMessage) => (language === 'zh-CN' ? homeZhCN[key] : key);
  return (
    <main className="website_page" lang={language}>
      <header className="website_header website_shell">
        <div className="website_brandGroup">
          <Brand locale={locale} label={t('Steer home')} />
          <span className="website_brandByline">with Relay</span>
        </div>
        <nav className="website_nav" aria-label={t('Main navigation')}>
          <a href="#product">{t('Product')}</a>
          <a href="#relay">Relay</a>
          <a href="#channels">{t('Integrations')}</a>
          <a className="website_github" href="https://github.com/KDF5000/steer">
            GitHub <ArrowUpRight size={13} />
          </a>
          <a className="website_openSteer" href={appUrl} data-workspace-link>
            {t('Open Steer')} <ArrowRight size={14} />
          </a>
          <nav
            className="website_languageSwitch"
            aria-label={
              language === 'zh-CN' ? '界面语言' : 'Interface language'
            }
          >
            <a
              href="/zh/"
              hrefLang="zh-CN"
              lang="zh-CN"
              data-language="zh"
              aria-current={locale === 'zh' ? 'page' : undefined}
            >
              中文
            </a>
            <a
              href="/en/"
              hrefLang="en"
              lang="en"
              aria-label="English"
              data-language="en"
              aria-current={locale === 'en' ? 'page' : undefined}
            >
              EN
            </a>
          </nav>
        </nav>
      </header>

      <section
        className="website_hero website_shell"
        aria-labelledby="hero-title"
      >
        <div className="website_heroCopy">
          <p className="website_eyebrow">
            <span className="website_statusDot" />
            {t('An open-source workspace for your agents')}
          </p>
          <h1 id="hero-title">
            <span className="website_heroFirstLine">
              <span>{t('Different machines.')}</span>
              <span>{t('Different agents.')}</span>
            </span>
            <span className="website_heroConclusion">
              {t('One workspace.')}
            </span>
          </h1>
          <p className="website_lead">
            {t('Bring Codex, Trae, Claude Code, and Pi into one workspace.')}
            <br />
            {t(
              'Run tasks on local or remote machines. Organize your work through projects and conversations.',
            )}
          </p>
          <div className="website_actions">
            <a
              className="website_primaryButton"
              href={appUrl}
              data-workspace-link
            >
              {t('Enter workspace')} <ArrowRight size={16} />
            </a>
            <a
              className="website_secondaryButton"
              href="https://github.com/KDF5000/steer#readme"
            >
              {t('Self-hosted')} <ArrowUpRight size={15} />
            </a>
          </div>
          <p className="website_heroNote">
            <span>{t('Open source')}</span>
            <i />
            <span>{t('Self-hosted')}</span>
            <i />
            <span>{t('Bring your own runtimes')}</span>
          </p>
        </div>
        <figure className="website_productVisual">
          <div className="website_screenshotFrame">
            <div className="website_windowBar">
              <div className="website_windowDots" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <span>
                <ShieldCheck size={12} />
                {t('Your workspace. Your infrastructure.')}
              </span>
              <span className="website_windowLabel">STEER / WORKSPACE</span>
            </div>
            <a
              className="website_screenshotLink"
              href={`${screenshot}.png`}
              target="_blank"
              rel="noreferrer"
              aria-label={t(
                'View the full Steer workspace screenshot in a new tab',
              )}
            >
              <img
                alt={t(
                  'The real Steer interface with an example project conversation and a generated getting-started guide in the document preview panel',
                )}
                className="website_screenshot"
                width={1280}
                height={800}
                fetchPriority="high"
                decoding="async"
                src={`${screenshot}-1x.png`}
                srcSet={`${screenshot}-1x.png 1280w, ${screenshot}.png 2560w`}
                sizes="(max-width: 760px) 100vw, (max-width: 1200px) 90vw, 1084px"
              />
              <span className="website_imageHint">
                {t('View full image')} <ArrowUpRight size={13} />
              </span>
            </a>
          </div>
          <figcaption>
            <span>
              {t('Projects, conversations, and documents in one view.')}
            </span>
            <span>
              {t('Real Steer interface · example task')}{' '}
              <ArrowUpRight size={12} />
            </span>
          </figcaption>
        </figure>
        <div className="website_runtimeStrip">
          <span>{t('Familiar agents. One way to work.')}</span>
          <div>
            <strong>Codex</strong>
            <i />
            <strong>Trae</strong>
            <i />
            <strong>Claude Code</strong>
            <i />
            <strong>Pi</strong>
          </div>
          <span className="website_runtimePowered">Connected by Relay</span>
        </div>
      </section>

      <section className="website_story website_shell" id="product">
        <div className="website_sectionHeading">
          <p className="website_sectionLabel">01 / THE EXPERIENCE</p>
          <h2>
            {t('Choose a project. ')}
            <br />
            {t('Give your agent a task.')}
          </h2>
          <p>
            {t(
              'Start with a task. Review the result, ask follow-up questions, and keep going.',
            )}
          </p>
        </div>
        <div className="website_journey">
          <article>
            <div className="website_miniVisual">
              <div className="website_promptHeader">
                <span className="website_miniAvatar">S</span>
                <span>{t('Steer / Release prep')}</span>
                <span className="website_miniTag">Project</span>
              </div>
              <p className="website_promptText">
                {t('Review the changes and draft release notes.')}
              </p>
              <div className="website_promptFooter">
                <span>
                  <FolderGit2 size={13} /> Steer
                </span>
                <span>
                  <Terminal size={13} /> Codex
                </span>
                <span className="website_sendIcon">
                  <ArrowUpRight size={14} />
                </span>
              </div>
            </div>
            <div className="website_stepHeading">
              <span>01</span>
              <h3>{t('Choose a project and an agent')}</h3>
            </div>
            <p>{t('Choose a project and an agent, then describe the task.')}</p>
          </article>
          <article>
            <div className="website_miniVisual website_executionVisual">
              <div className="website_executionTop">
                <span>
                  <Server size={15} /> dev-machine / codex
                </span>
                <span className="website_miniTag">{t('Example run')}</span>
              </div>
              <div className="website_executionRow">
                <Check size={13} />
                <span>{t('Read project and branch')}</span>
                <small>{t('Done')}</small>
              </div>
              <div className="website_executionRow">
                <Check size={13} />
                <span>{t('Review changes and checks')}</span>
                <small>{t('Done')}</small>
              </div>
              <div className="website_executionRow">
                <span className="website_progressDot" />
                <span>{t('Prepare release notes')}</span>
                <div className="website_progressTrack">
                  <i />
                </div>
              </div>
            </div>
            <div className="website_stepHeading">
              <span>02</span>
              <h3>{t('Follow the task as it runs')}</h3>
            </div>
            <p>
              {t('Follow progress in real time and stop a task when needed.')}
            </p>
          </article>
          <article>
            <div className="website_miniVisual website_deliveryVisual">
              <div className="website_fileIcon">
                <FileText size={24} strokeWidth={1.4} />
              </div>
              <div>
                <strong>release-notes.md</strong>
                <span>{t('Release notes \u00b7 Markdown')}</span>
              </div>
              <div className="website_deliveryBottom">
                <span>
                  <CheckCheck size={14} />
                  {t('Artifact saved')}
                </span>
                <span>
                  {t('Revisit anytime')} <ArrowUpRight size={12} />
                </span>
              </div>
            </div>
            <div className="website_stepHeading">
              <span>03</span>
              <h3>{t('Review the result. Follow up.')}</h3>
            </div>
            <p>
              {t(
                'Review files and changes. Keep going in the same conversation.',
              )}
            </p>
          </article>
        </div>
      </section>

      <section
        className="website_features website_shell"
        aria-label={t('Workspace capabilities')}
      >
        <div className="website_highlights">
          <article className="website_handoff">
            <p className="website_highlightLabel">
              {t('ONE CONVERSATION. DIFFERENT AGENTS.')}
            </p>
            <h2>{t('Switch agents. Keep going.')}</h2>
            <p className="website_highlightCopy">
              {t(
                'Switch agents in the same conversation and keep the previous messages as context. Go from coding to review without explaining the task again.',
              )}
            </p>
            <div
              className="website_handoffRoles"
              aria-label={t('An example agent handoff')}
            >
              <span>
                <Code2 size={15} />
                {t('Coding agent')}
              </span>
              <ArrowRight size={15} aria-hidden="true" />
              <span>
                <CheckCheck size={15} />
                {t('Review agent')}
              </span>
              <small>{t('Same conversation')}</small>
            </div>
            <figure className="website_handoffFigure">
              <a
                href={handoffScreenshot}
                target="_blank"
                rel="noreferrer"
                aria-label={t('View the agent handoff screenshot in a new tab')}
              >
                <img
                  src={handoffScreenshot}
                  width={1680}
                  height={1320}
                  loading="lazy"
                  decoding="async"
                  alt={t(
                    'Real Steer conversation with completed implementation, the review agent selected, and a follow-up ready to send',
                  )}
                />
              </a>
              <figcaption>
                {t('Real interface · example conversation, ready for review')}
              </figcaption>
            </figure>
            <p className="website_handoffNote">
              {t(
                'Switch between agents compatible with the conversation’s runtime.',
              )}
            </p>
          </article>
          <div className="website_supportingHighlights">
            <article>
              <Network size={23} strokeWidth={1.5} />
              <h3>{t('Run on your own machines.')}</h3>
              <p>
                {t(
                  'Use an existing local directory, or create a separate Git worktree for each conversation.',
                )}
              </p>
              <div className="website_projectOptions">
                <span>
                  <FolderGit2 size={17} />
                  <span>
                    {t('Local directory')}
                    <small>{t('Work where your files live')}</small>
                  </span>
                </span>
                <span>
                  <GitBranch size={17} />
                  <span>
                    {t('Git worktree')}
                    <small>{t('Separate changes for each conversation')}</small>
                  </span>
                </span>
              </div>
            </article>
            <article>
              <FileText size={23} strokeWidth={1.5} />
              <h3>{t('See the process. Keep the result.')}</h3>
              <p>
                {t(
                  'Follow the task, review code changes, and open generated documents beside the conversation.',
                )}
              </p>
              <div className="website_resultPreview">
                <FileText size={25} strokeWidth={1.3} />
                <span>
                  <strong>release-notes.md</strong>
                  <small>{t('Preview, download, revisit')}</small>
                </span>
                <CheckCheck size={17} />
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="website_relay website_shell" id="relay">
        <div className="website_relayCopy">
          <p className="website_sectionLabel">02 / POWERED BY RELAY</p>
          <h2>
            {t('One place to work.')}
            <br />
            <span>{t('Many places to run.')}</span>
          </h2>
          <p>
            {t(
              'Steer organizes your agents, projects, and conversations. Relay runs tasks on local or remote machines and brings back progress and files. Use Relay with Steer, or connect it to your own app through its API and SDK.',
            )}
          </p>
          <a
            className="website_relayLink"
            href="https://github.com/KDF5000/relay"
          >
            {t('Explore Relay')} <ArrowUpRight size={15} />
          </a>
          <div className="website_relayPrinciples">
            <span>
              <ShieldCheck size={14} />
              {t('Self-hosted')}
            </span>
            <span>
              <GitBranch size={14} />
              {t('Multiple runtimes')}
            </span>
            <span>
              <Blocks size={14} />
              {t('Independent integration')}
            </span>
          </div>
        </div>
        <div
          className="website_architecture"
          aria-label={t(
            'Architecture diagram: Steer connects to local and remote runtimes through Relay',
          )}
        >
          <div className="website_archSteer">
            <img src="/favicon.svg" width={29} height={29} alt="" />
            <div>
              <strong>Steer</strong>
              <span>Conversation · Project · Artifact</span>
            </div>
            <small>{t('Workspace')}</small>
          </div>
          <div className="website_connector">
            <span />
          </div>
          <div className="website_archRelay">
            <Network size={20} />
            <strong>Relay</strong>
            <span>{t('Discover \u00b7 Route \u00b7 Run')}</span>
          </div>
          <div className="website_branchConnector" aria-hidden="true" />
          <div className="website_nodeGrid">
            <div>
              <Monitor size={19} />
              <strong>{t('Local machine')}</strong>
              <span>Codex / Trae</span>
            </div>
            <div>
              <Server size={19} />
              <strong>{t('Remote node')}</strong>
              <span>Claude Code / Pi</span>
            </div>
          </div>
          <p className="website_archCaption">
            {t('Your machines. Your tools. Your control.')}
          </p>
        </div>
      </section>

      <section className="website_channels website_shell" id="channels">
        <div className="website_channelHeading">
          <div>
            <p className="website_sectionLabel">03 / CONNECT YOUR WAY</p>
            <h2>
              {t('Work with agents, ')}
              <br />
              {t('wherever you work.')}
            </h2>
          </div>
          <p>
            {t('Start a task from the web, your team chat, or your own app. ')}
            <br className="website_desktopBreak" />
            {t('Work with the agents and projects you already have in Steer.')}
          </p>
        </div>
        <div className="website_channelGrid">
          {channels.map(({ icon: Icon, title, copy, href, label }) => (
            <a
              key={t(title)}
              href={href === '/fusion' ? appUrl : href}
              data-workspace-link={href === '/fusion' || undefined}
              className="website_channelCard"
            >
              <Icon size={23} strokeWidth={1.5} />
              <h3>{t(title)}</h3>
              <p>{t(copy)}</p>
              <span>
                {t(label)}
                <ArrowUpRight size={15} />
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="website_finalCta website_shell">
        <div className="website_ctaMark">
          <img src="/favicon.svg" width={40} height={40} alt="" />
        </div>
        <p className="website_sectionLabel">MAKE ROOM FOR WHAT’S NEXT</p>
        <h2>
          {t('Your next idea ')}
          <br className="website_mobileBreak" />
          {t('starts here.')}
        </h2>
        <p>
          {t(
            'Connect a runtime, add a project, and start your first conversation.',
          )}
        </p>
        <div className="website_actions">
          <a
            className="website_primaryButton"
            href={appUrl}
            data-workspace-link
          >
            {t('Get started with Steer')} <ArrowRight size={16} />
          </a>
          <a
            className="website_textLink"
            href="https://github.com/KDF5000/steer#readme"
          >
            {t('Read the deployment guide')} <ArrowUpRight size={15} />
          </a>
        </div>
      </section>
      <footer className="website_footer website_shell">
        <div className="website_footerTop">
          <div>
            <Brand locale={locale} label={t('Steer home')} />
            <p>{t('Your agents and machines, brought together.')}</p>
          </div>
          <div className="website_footerLinks">
            <a href="https://github.com/KDF5000/steer">
              Steer <ArrowUpRight size={12} />
            </a>
            <a href="https://github.com/KDF5000/relay">
              Relay <ArrowUpRight size={12} />
            </a>
            <a href="https://github.com/KDF5000/steer#readme">
              {t('Docs')} <ArrowUpRight size={12} />
            </a>
            <a href="#product">
              {t('Explore the product')} <ArrowUpRight size={12} />
            </a>
          </div>
        </div>
        <div className="website_footerBottom">
          <span>© 2026 Steer & Relay</span>
          <span>
            <Globe2 size={12} /> Open source. On your terms.
          </span>
        </div>
      </footer>
    </main>
  );
}
