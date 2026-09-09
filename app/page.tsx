'use client';

import {
  Archive,
  ArrowRight,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  FileCode2,
  FileText,
  Files,
  GitBranch,
  Inbox,
  LayoutDashboard,
  MessageSquareText,
  MoreHorizontal,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

const decisions = [
  {
    id: 'architecture',
    kind: '需要决策',
    tone: 'blue',
    title: '选择认证模块的重构路径',
    summary: '三个 Agent 完成了代码分析和方案比较，建议采用渐进式迁移。',
    meta: '支付系统重构 · 12 分钟前',
    effort: '约 4 分钟',
    minutes: 4,
  },
  {
    id: 'review',
    kind: '等待 Review',
    tone: 'amber',
    title: '确认 Token 刷新逻辑的代码变更',
    summary: '已修改 7 个文件并通过 42 项测试，有一处兼容性风险需要确认。',
    meta: '支付系统重构 · 28 分钟前',
    effort: '约 6 分钟',
    minutes: 6,
  },
  {
    id: 'blocked',
    kind: '需要补充',
    tone: 'red',
    title: '明确旧客户端的支持期限',
    summary: '缺少兼容期限，Agent 暂停生成最终迁移计划。',
    meta: '移动端升级 · 1 小时前',
    effort: '约 2 分钟',
    minutes: 2,
  },
];

export default function Home() {
  const [view, setView] = useState('attention');
  const [selected, setSelected] = useState(decisions[0]);
  const [resolved, setResolved] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const resolveDecision = useCallback(
    (id: string, outcome: 'accepted' | 'revision') => {
      const nextResolved = resolved.includes(id) ? resolved : [...resolved, id];
      setResolved(nextResolved);
      const nextDecision = decisions.find(
        (decision) => !nextResolved.includes(decision.id),
      );
      if (nextDecision) setSelected(nextDecision);
      setEvidenceOpen(false);
      setNotice(
        outcome === 'accepted'
          ? '已采用推荐方案，Agent 正在生成实施计划。'
          : '已要求 Agent 调整方案并补充依据。',
      );
      window.setTimeout(() => setNotice(''), 3200);
    },
    [resolved],
  );

  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: object,
            options?: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: 'resolve_attention_item',
          title: '处理待决策事项',
          description:
            '采用 Steer 中某个待决策事项的推荐方案，或要求 Agent 修改方案。',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', enum: decisions.map((item) => item.id) },
              outcome: { type: 'string', enum: ['accepted', 'revision'] },
            },
            required: ['id', 'outcome'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input: unknown) {
            const value = input as {
              id?: string;
              outcome?: 'accepted' | 'revision';
            };
            if (
              !value.id ||
              !decisions.some((item) => item.id === value.id) ||
              !['accepted', 'revision'].includes(value.outcome || '')
            )
              throw new Error('Invalid decision or outcome');
            resolveDecision(value.id, value.outcome!);
            return { id: value.id, outcome: value.outcome, status: 'recorded' };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);
    return () => lifecycle.abort();
  }, [resolveDecision]);

  const pendingDecisions = decisions.filter(
    (decision) => !resolved.includes(decision.id),
  );
  const pendingMinutes = pendingDecisions.reduce(
    (total, decision) => total + decision.minutes,
    0,
  );

  const titles: Record<string, [string, string]> = {
    attention: ['工作台 / Attention', '需要你的判断'],
    workstreams: ['工作台 / Workstreams', '正在推进的目标'],
    artifacts: ['工作台 / Artifacts', '成果与版本'],
    activity: ['工作台 / Activity', '执行记录'],
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">S</span>
          <span>
            steer<small>Human workspace</small>
          </span>
        </div>
        <nav className="primary-nav" aria-label="主要导航">
          <button
            onClick={() => setView('attention')}
            className={`nav-item ${view === 'attention' ? 'active' : ''}`}
          >
            <Inbox />
            <span>Attention</span>
            <b>{3 - resolved.length}</b>
          </button>
          <button
            onClick={() => setView('workstreams')}
            className={`nav-item ${view === 'workstreams' ? 'active' : ''}`}
          >
            <LayoutDashboard />
            <span>Workstreams</span>
          </button>
          <button
            onClick={() => setView('artifacts')}
            className={`nav-item ${view === 'artifacts' ? 'active' : ''}`}
          >
            <Files />
            <span>Artifacts</span>
          </button>
          <button
            onClick={() => setView('activity')}
            className={`nav-item ${view === 'activity' ? 'active' : ''}`}
          >
            <Archive />
            <span>Activity</span>
          </button>
        </nav>
        <div className="sidebar-note">
          <span className="pulse-dot" />
          <div>
            <strong>Relay 已连接</strong>
            <small>2 个 Runtime 可用</small>
          </div>
        </div>
        <button className="profile">
          <span>K</span>
          <div>
            <strong>Kongdefei</strong>
            <small>个人工作区</small>
          </div>
          <MoreHorizontal />
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="breadcrumb">{titles[view][0]}</span>
            <h1>{titles[view][1]}</h1>
          </div>
          <button className="date-control">
            今天，9 月 9 日 <ChevronDown />
          </button>
        </header>

        {view === 'attention' && (
          <div className="attention-layout">
            <section className="attention-feed" aria-label="待处理事项">
              <div className="focus-summary">
                <div className="focus-ring">
                  <span>{pendingDecisions.length}</span>
                  <small>项</small>
                </div>
                <div>
                  <strong>
                    {pendingMinutes > 0
                      ? `预计需要 ${pendingMinutes} 分钟`
                      : '今天无需额外判断'}
                  </strong>
                  <p>Agent 已处理其余 18 项工作，只把需要判断的部分交给你。</p>
                </div>
              </div>

              <div className="section-row">
                <h2>现在处理</h2>
                <span>按影响排序</span>
              </div>
              <div className="decision-list">
                {pendingDecisions.map((decision) => (
                  <button
                    key={decision.id}
                    className={`decision-card ${selected.id === decision.id ? 'selected' : ''}`}
                    onClick={() => setSelected(decision)}
                  >
                    <span className={`kind ${decision.tone}`}>
                      {decision.kind}
                    </span>
                    <span className="card-title">{decision.title}</span>
                    <span className="card-summary">{decision.summary}</span>
                    <span className="card-footer">
                      <span>{decision.meta}</span>
                      <span>
                        {decision.effort}
                        <ArrowRight />
                      </span>
                    </span>
                  </button>
                ))}
              </div>

              {!decisions.some((item) => !resolved.includes(item.id)) && (
                <div className="all-clear">
                  <Check />
                  <strong>Attention 已清空</strong>
                  <span>其余工作都在设定的自治边界内推进。</span>
                </div>
              )}
              <div className="quiet-row">
                <Check />
                <span>
                  <strong>{18 + resolved.length} 项工作无需介入</strong>
                  <small>已自动完成或仍在安全边界内执行</small>
                </span>
                <button>查看摘要</button>
              </div>
            </section>

            {pendingDecisions.length > 0 && (
              <aside className="decision-panel" aria-label="决策详情">
                <div className="panel-header">
                  <span className={`kind ${selected.tone}`}>
                    {selected.kind}
                  </span>
                  <button aria-label="更多操作">
                    <MoreHorizontal />
                  </button>
                </div>
                <h2>{selected.title}</h2>
                <p className="lead">
                  登录模块耦合了 Session、Token 刷新和客户端兼容逻辑。Agent
                  分析了 36 个调用点，并形成三种可实施方案。
                </p>

                <div className="recommendation">
                  <span>
                    <Sparkles />
                  </span>
                  <div>
                    <small>推荐方案</small>
                    <strong>渐进式迁移到独立 Auth Service</strong>
                    <p>
                      风险可控，不需要一次性修改所有客户端，预计用两个迭代完成。
                    </p>
                  </div>
                </div>

                <div className="section-row compact">
                  <h3>为什么推荐</h3>
                  <button>查看全部分析</button>
                </div>
                <ul className="reason-list">
                  <li>
                    <Check />
                    <span>现有 API 保持兼容，发布风险最低</span>
                  </li>
                  <li>
                    <Check />
                    <span>新旧 Token 可以并行验证，支持快速回滚</span>
                  </li>
                  <li>
                    <Check />
                    <span>比完全重写少修改约 42% 的代码</span>
                  </li>
                </ul>

                <div className="section-row compact">
                  <h3>依据</h3>
                  <span>4 项</span>
                </div>
                <div className="evidence-grid">
                  <button onClick={() => setEvidenceOpen(true)}>
                    <FileCode2 />
                    <span>
                      <strong>代码分析</strong>
                      <small>36 个调用点</small>
                    </span>
                  </button>
                  <button onClick={() => setEvidenceOpen(true)}>
                    <GitBranch />
                    <span>
                      <strong>方案对比</strong>
                      <small>3 个候选方案</small>
                    </span>
                  </button>
                </div>

                {evidenceOpen && (
                  <div className="evidence-preview">
                    <div>
                      <span>证据预览</span>
                      <button onClick={() => setEvidenceOpen(false)}>
                        关闭
                      </button>
                    </div>
                    <strong>认证模块调用关系</strong>
                    <p>
                      12 个服务直接调用旧 Token API，24
                      个调用通过兼容层完成。测试覆盖率
                      87%，主要风险集中在移动端离线刷新。
                    </p>
                    <code>auth/session → token/refresh → clients/*</code>
                  </div>
                )}

                <div className="panel-actions">
                  <button
                    onClick={() => resolveDecision(selected.id, 'revision')}
                    className="secondary"
                  >
                    <MessageSquareText />
                    要求调整
                  </button>
                  <button
                    onClick={() => resolveDecision(selected.id, 'accepted')}
                    className="primary"
                  >
                    采用推荐方案
                    <ArrowRight />
                  </button>
                </div>
                <p className="action-note">
                  <CircleDot />
                  确认后，Agent 将生成实施计划，但不会直接修改代码。
                </p>
              </aside>
            )}
          </div>
        )}

        {view === 'workstreams' && (
          <Workstreams onOpen={() => setView('attention')} />
        )}
        {view === 'artifacts' && <Artifacts />}
        {view === 'activity' && <Activity />}
      </section>
      {notice && (
        <output className="toast">
          <Check />
          {notice}
        </output>
      )}
    </main>
  );
}

function Workstreams({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="content-view">
      <div className="view-intro">
        <p>围绕目标查看状态、关键决策和最终成果，Agent 只是执行来源。</p>
        <button>＋ 新建目标</button>
      </div>
      <div className="workstream-grid">
        <article className="workstream-card featured">
          <div className="workstream-top">
            <span className="project-icon">P</span>
            <span className="state-chip running">推进中</span>
          </div>
          <h2>支付系统重构</h2>
          <p>降低认证耦合，完成 Token 体系迁移，并保持旧客户端兼容。</p>
          <div className="progress">
            <span style={{ width: '64%' }} />
          </div>
          <div className="progress-meta">
            <span>整体进度 64%</span>
            <span>2 个 Agent 执行中</span>
          </div>
          <div className="stream-stats">
            <span>
              <b>3</b> 已接受成果
            </span>
            <span>
              <b>2</b> 待判断
            </span>
            <span>
              <b>1</b> 风险
            </span>
          </div>
          <button className="open-stream" onClick={onOpen}>
            处理下一项决策
            <ArrowRight />
          </button>
        </article>
        <article className="workstream-card">
          <div className="workstream-top">
            <span className="project-icon violet">M</span>
            <span className="state-chip">规划中</span>
          </div>
          <h2>移动端升级</h2>
          <p>统一 API 协议并完成旧版本退出计划。</p>
          <div className="progress">
            <span style={{ width: '31%' }} />
          </div>
          <div className="progress-meta">
            <span>整体进度 31%</span>
            <span>等待 1 项输入</span>
          </div>
          <div className="stream-stats">
            <span>
              <b>1</b> 已接受成果
            </span>
            <span>
              <b>1</b> 待判断
            </span>
          </div>
        </article>
        <article className="workstream-card">
          <div className="workstream-top">
            <span className="project-icon green">D</span>
            <span className="state-chip quiet">观察中</span>
          </div>
          <h2>开发者文档质量</h2>
          <p>持续检查文档覆盖、示例可运行性和版本一致性。</p>
          <div className="progress">
            <span style={{ width: '82%' }} />
          </div>
          <div className="progress-meta">
            <span>本轮进度 82%</span>
            <span>无需介入</span>
          </div>
          <div className="stream-stats">
            <span>
              <b>6</b> 已接受成果
            </span>
            <span>
              <b>0</b> 待判断
            </span>
          </div>
        </article>
      </div>
    </div>
  );
}

function Artifacts() {
  const artifacts = [
    ['技术设计', '认证服务渐进式迁移设计', 'v3', '待决策', '今天 14:32'],
    ['代码变更', 'Token 刷新兼容层', '7 个文件', '等待 Review', '今天 14:16'],
    ['分析报告', '认证模块调用关系', '36 个调用点', '已接受', '今天 13:48'],
    ['测试报告', 'Auth 回归测试结果', '42 / 42 通过', '已接受', '今天 13:31'],
    ['实施计划', '移动端 API 升级计划', 'v1', '草稿', '昨天'],
  ];
  return (
    <div className="content-view">
      <div className="view-intro">
        <p>这里保存可继续使用的成果，而不是 Run 的附件列表。</p>
        <div className="segmented">
          <button className="active">全部</button>
          <button>待审</button>
          <button>已接受</button>
        </div>
      </div>
      <div className="artifact-table">
        <div className="artifact-head">
          <span>成果</span>
          <span>版本 / 摘要</span>
          <span>状态</span>
          <span>更新时间</span>
        </div>
        {artifacts.map(([type, name, version, status, time]) => (
          <button className="artifact-row" key={name}>
            <span>
              <FileText />
              <span>
                <strong>{name}</strong>
                <small>{type} · 支付系统重构</small>
              </span>
            </span>
            <span>{version}</span>
            <span>
              <i
                className={`artifact-state ${status === '已接受' ? 'accepted' : ''}`}
              >
                {status}
              </i>
            </span>
            <span>{time}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Activity() {
  const events = [
    [
      '14:32',
      'Steer',
      '生成了一项决策请求',
      '认证模块的三个方案已经完成比较，只保留需要你判断的差异。',
    ],
    [
      '14:28',
      'Trae · Seed-2.1-Turbo',
      '完成代码分析',
      '检查 36 个调用点，产出「认证模块调用关系」。',
    ],
    [
      '14:16',
      'Codex · gpt-5.6',
      '提交代码变更',
      '修改 7 个文件，42 项测试全部通过。',
    ],
    [
      '13:48',
      'Steer',
      '接受成果',
      '「认证模块调用关系」被标记为当前有效版本。',
    ],
  ];
  return (
    <div className="content-view activity-view">
      <div className="view-intro">
        <p>完整执行轨迹用于追溯和排障，不竞争你的日常注意力。</p>
        <button className="ghost-control">
          <ShieldCheck />
          自治策略
        </button>
      </div>
      <div className="activity-day">
        <h2>今天</h2>
        {events.map(([time, actor, title, body], index) => (
          <article className="activity-event" key={time}>
            <time>{time}</time>
            <span className={`event-dot ${index === 0 ? 'system' : ''}`} />
            <div>
              <small>{actor}</small>
              <strong>{title}</strong>
              <p>{body}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="relay-strip">
        <Clock3 />
        <span>
          <strong>Relay 执行状态正常</strong>
          <small>最近 24 小时完成 21 次 Run，失败 1 次并已自动恢复</small>
        </span>
        <button>查看底层运行</button>
      </div>
    </div>
  );
}
