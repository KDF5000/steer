import { homeZhCN, type HomeMessage } from './i18n';
import {
  Activity,
  Settings2,
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

const features = [
  {
    icon: Settings2,
    title: 'Agents configured for the job',
    copy: 'Set instructions, choose a model, and attach skills to each agent. Keep separate profiles for coding, review, or documentation.',
    label: 'Instructions, models & skills',
  },
  {
    icon: Activity,
    title: 'Progress you can inspect',
    copy: 'Watch output arrive, expand the execution details, and cancel a task when the plan changes. Return to the conversation to review what happened.',
    label: 'Streaming & task control',
  },
  {
    icon: MessageSquare,
    title: 'Keep the conversation going',
    copy: 'Follow up in the same conversation with its history, project, and execution environment intact. Return later to review the work or take the next step.',
    label: 'Persistent conversations',
  },
  {
    icon: FolderGit2,
    title: 'Local directories or Git worktrees',
    copy: 'Work directly in an existing directory on a selected machine, or give each conversation its own Git worktree for separate changes.',
    label: 'Local & Git projects',
  },
  {
    icon: Network,
    title: 'Choose the tool and the machine',
    copy: 'Bind an agent to a runtime on a specific node, or select automatically by provider. Once a conversation starts, its execution environment stays pinned.',
    label: 'Flexible runtime routing',
  },
  {
    icon: FileText,
    title: 'Preview the files your agent produces',
    copy: 'Open generated documents beside the conversation, inspect session files and code changes, or download artifacts to use elsewhere.',
    label: 'Durable artifacts',
  },
] as const;

const channels = [
  {
    icon: Monitor,
    title: 'Steer Web',
    copy: 'Send text or images, follow execution, and review files beside the conversation.',
    href: '/fusion',
    label: 'Open workspace',
  },
  {
    icon: MessageSquare,
    title: 'Feishu bot',
    copy: 'Connect a bot in Settings. Choose projects in chat, continue in a thread, and check progress with /status.',
    href: 'https://github.com/KDF5000/steer/blob/main/docs/feishu-integration.md',
    label: 'Explore the Feishu integration',
  },
  {
    icon: Code2,
    title: 'Conversation Task API',
    copy: 'Create or continue conversations with an API key. Stream events, retrieve artifacts, and cancel tasks.',
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
            {t('An open-source workspace for your agent tools')}
          </p>
          <h1 id="hero-title">
            {t('Agent work. ')}
            <br className="website_mobileBreak" />
            {t('Pick up ')}
            <span>{t('where you left off.')}</span>
          </h1>
          <p className="website_lead">
            {t('Bring Codex, Trae, Claude Code, and Pi into one workspace.')}
            <br />
            {t(
              'Work in your own projects and on your own machines. Keep the conversation, progress, and files together.',
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
              {t(
                'A project, a conversation, and the generated document side by side.',
              )}
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
              'Review changes, investigate a bug, or write a guide. Start with the repository and tools you already use.',
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
            <p>
              {t(
                'Select a local or Git project and an agent with the right instructions, model, and skills. Send a goal, a question, or an image.',
              )}
            </p>
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
              {t(
                'Relay prepares the workspace and sends the task to the chosen runtime. Follow streaming output, inspect the process, or cancel when needed.',
              )}
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
                'Read the answer, inspect code changes, and preview any generated files. Continue in the same conversation when the work needs another pass.',
              )}
            </p>
          </article>
        </div>
      </section>

      <section
        className="website_features website_shell"
        aria-label={t('Workspace capabilities')}
      >
        <div className="website_featureGrid">
          {features.map(({ icon: Icon, title, copy, label }) => (
            <article key={t(title)}>
              <Icon size={21} strokeWidth={1.5} />
              <div>
                <h3>{t(title)}</h3>
                <p>{t(copy)}</p>
                <span>{t(label)}</span>
              </div>
            </article>
          ))}
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
              'Steer gives you projects, agent profiles, and conversations. Relay discovers runtimes, prepares workspaces, dispatches tasks, and returns events and artifacts. Deploy Relay independently, or use its API and SDK in your own application.',
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
            {t('Use the agents and projects already configured in Steer.')}
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
            <p>{t('A place to return to. A way to keep going.')}</p>
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
