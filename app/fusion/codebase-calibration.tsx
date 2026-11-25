'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import {
  steer,
  type CodebaseCalibrationStats,
  type CodebaseRepositoryRecord,
  type CodebaseWorkflowRecord,
} from '@/lib/steer-client';

const DAY_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 0, label: 'All time' },
] as const;

const POLICY_BADGE_STYLE: Record<string, string> = {
  auto_approve_eligible:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  human_review_light:
    'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  human_review_required:
    'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  block: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  unknown: 'bg-muted text-muted-foreground border-border',
};

const RISK_BADGE_STYLE: Record<string, string> = {
  R0: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  R1: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30',
  R2: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  R3: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  unknown: 'bg-muted text-muted-foreground border-border',
};

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  const rounded = Math.round(sec);
  if (rounded < 60) return `${rounded}s`;
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatPct(num: number, den: number): string {
  if (!den || den <= 0) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}

function shortSha(sha: string): string {
  const trimmed = (sha || '').trim();
  return trimmed.length > 10 ? trimmed.slice(0, 10) : trimmed || '—';
}

export function CodebaseCalibrationView({
  active,
  repositories,
  workflows,
}: {
  active: boolean;
  repositories: CodebaseRepositoryRecord[];
  workflows: CodebaseWorkflowRecord[];
}) {
  const { t, language } = useI18n();
  const isZh = language.startsWith('zh');
  const [days, setDays] = useState<number>(30);
  const [repoId, setRepoId] = useState<string>('');
  const [workflowId, setWorkflowId] = useState<string>('');
  const [stats, setStats] = useState<CodebaseCalibrationStats | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [refreshNonce, setRefreshNonce] = useState<number>(0);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    setError('');
    setRefreshNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    steer
      .codebaseCalibration(
        {
          days,
          repoId: repoId || undefined,
          workflowId: workflowId || undefined,
        },
        controller.signal,
      )
      .then((next) => {
        if (!controller.signal.aborted) {
          setStats(next);
          setError('');
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [active, days, repoId, workflowId, refreshNonce]);

  const ov = stats?.overview;
  const maxDaily = Math.max(
    1,
    ...(stats?.dailyTrend.map((d) => d.totalRuns) ?? [1]),
  );

  return (
    <div className="space-y-5 p-1">
      {/* Toolbar / filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={isZh ? '时间范围' : 'Time range'}
            className="h-8 rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {DAY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.label)}
              </option>
            ))}
          </select>

          <select
            aria-label={isZh ? '按仓库筛选' : 'Filter by repository'}
            className="h-8 max-w-[220px] rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
            value={repoId}
            onChange={(e) => setRepoId(e.target.value)}
          >
            <option value="">{isZh ? '全部仓库' : 'All repositories'}</option>
            {repositories.map((repo) => (
              <option key={repo.repoId} value={repo.repoId}>
                {repo.repoPath}
              </option>
            ))}
          </select>

          <select
            aria-label={isZh ? '按流程筛选' : 'Filter by workflow'}
            className="h-8 max-w-[220px] rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
            value={workflowId}
            onChange={(e) => setWorkflowId(e.target.value)}
          >
            <option value="">{isZh ? '全部流程' : 'All workflows'}</option>
            {workflows.map((wf) => (
              <option key={wf.id} value={wf.id}>
                {wf.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="ws-automation-button inline-flex items-center gap-1.5"
          disabled={loading}
          onClick={handleRefresh}
        >
          <RefreshCw
            className={`h-3.5 w-3.5${loading ? ' animate-spin' : ''}`}
          />
          {isZh ? '刷新统计' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {!ov && !loading && !error && (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {t('No calibration data yet.')}
        </div>
      )}

      {ov && (
        <>
          {/* 6 KPI Summary Cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('Total reviews')}</span>
                <BarChart3 className="h-4 w-4 opacity-70" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-semibold">{ov.totalRuns}</span>
                <span className="text-xs text-muted-foreground">
                  {isZh
                    ? `覆盖 ${ov.uniqueMrs} 个 MR`
                    : `${ov.uniqueMrs} unique MRs`}
                </span>
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                {isZh
                  ? `成功 ${ov.succeededRuns} · 失败 ${ov.failedRuns} · 跳过 ${ov.skippedRuns} · 结构化 ${ov.structuredRuns}`
                  : `Succeeded ${ov.succeededRuns} · Failed ${ov.failedRuns} · Skipped ${ov.skippedRuns} · JSON ${ov.structuredRuns}`}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('Auto-approve eligible')}</span>
                <Sparkles className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatPct(
                    ov.autoApproveEligibleRuns,
                    ov.structuredRuns || ov.succeededRuns,
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {ov.autoApproveEligibleRuns} /{' '}
                  {ov.structuredRuns || ov.succeededRuns}
                </span>
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                {isZh
                  ? `轻量人审 ${ov.humanLightRuns} · Fast 轨 ${ov.fastTrackRuns} / Deep 轨 ${ov.deepTrackRuns}`
                  : `Light human ${ov.humanLightRuns} · Fast ${ov.fastTrackRuns} / Deep ${ov.deepTrackRuns}`}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('Shadow consistency')}</span>
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-semibold">
                  {formatPct(
                    ov.autoApproveMergedUnchanged,
                    ov.autoApproveMergedTotal,
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {isZh
                    ? `已合入 ${ov.autoApproveMergedTotal} 个`
                    : `${ov.autoApproveMergedTotal} merged`}
                </span>
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                {isZh
                  ? `直接合入 ${ov.autoApproveMergedUnchanged} · 合入前又改 ${ov.autoApproveModifiedBeforeMerge}`
                  : `Unchanged ${ov.autoApproveMergedUnchanged} · Modified ${ov.autoApproveModifiedBeforeMerge}`}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('Review duration')}</span>
                <Clock className="h-4 w-4 opacity-70" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-semibold">
                  {formatDuration(ov.avgDurationSec)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {isZh ? '平均' : 'avg'}
                </span>
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                P50 {formatDuration(ov.p50DurationSec)} · P95{' '}
                {formatDuration(ov.p95DurationSec)}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('High-risk / blocked')}</span>
                <ShieldAlert className="h-4 w-4 text-amber-500" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-semibold">
                  {ov.blockedRuns + ov.humanRequiredRuns}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatPct(
                    ov.blockedRuns + ov.humanRequiredRuns,
                    ov.structuredRuns || ov.succeededRuns,
                  )}
                </span>
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                {isZh
                  ? `阻断 (block) ${ov.blockedRuns} · 强制人审 ${ov.humanRequiredRuns}`
                  : `Blocked ${ov.blockedRuns} · Mandatory human ${ov.humanRequiredRuns}`}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('Multi-round MRs')}</span>
                <AlertTriangle className="h-4 w-4 opacity-70" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-semibold">
                  {ov.multiRoundMrs}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatPct(ov.multiRoundMrs, ov.uniqueMrs)}
                </span>
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                {isZh
                  ? '经历 ≥ 2 轮增量复审的 MR 数量'
                  : 'MRs with ≥ 2 incremental review rounds'}
              </div>
            </div>
          </div>

          {/* Calibration Matrix: Risk Level x Merge Policy */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-medium">
              {t('Risk × Merge policy matrix')}
            </h3>
            {stats.matrix.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('No calibration data yet.')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">
                        {isZh ? '风险等级' : 'Risk'}
                      </th>
                      <th className="py-2 pr-3 font-medium">
                        {isZh ? '合入路由 (merge_policy)' : 'Merge Policy'}
                      </th>
                      <th className="py-2 pr-3 text-right font-medium">
                        {isZh ? '成功数' : 'Runs'}
                      </th>
                      <th className="py-2 pr-3 text-right font-medium">
                        {isZh ? '已合入' : 'Merged'}
                      </th>
                      <th className="py-2 pr-3 text-right font-medium">
                        {isZh ? '原 SHA 直接合入' : 'Unchanged'}
                      </th>
                      <th className="py-2 pr-3 text-right font-medium">
                        {isZh ? '合入前又改代码' : 'Modified'}
                      </th>
                      <th className="py-2 pr-3 text-right font-medium">
                        {isZh ? '一致率' : 'Consistency'}
                      </th>
                      <th className="py-2 text-right font-medium">
                        {isZh ? '平均耗时' : 'Avg time'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.matrix.map((row) => (
                      <tr
                        key={`${row.riskLevel}:${row.mergePolicy}`}
                        className="border-b border-border/50 last:border-0"
                      >
                        <td className="py-2 pr-3">
                          <span
                            className={`inline-flex rounded border px-1.5 py-0.5 font-mono text-[11px] ${RISK_BADGE_STYLE[row.riskLevel] || RISK_BADGE_STYLE.unknown}`}
                          >
                            {row.riskLevel}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={`inline-flex rounded border px-1.5 py-0.5 font-mono text-[11px] ${POLICY_BADGE_STYLE[row.mergePolicy] || POLICY_BADGE_STYLE.unknown}`}
                          >
                            {row.mergePolicy}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right font-medium">
                          {row.totalRuns}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {row.mergedTotal}
                        </td>
                        <td className="py-2 pr-3 text-right text-emerald-600 dark:text-emerald-400">
                          {row.mergedUnchanged}
                        </td>
                        <td className="py-2 pr-3 text-right text-amber-600 dark:text-amber-400">
                          {row.modifiedBeforeMerge}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {formatPct(row.mergedUnchanged, row.mergedTotal)}
                        </td>
                        <td className="py-2 text-right text-muted-foreground">
                          {formatDuration(row.avgDurationSec)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Risk Breakdown + Daily Trend */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-3 text-sm font-medium">
                {t('Risk level breakdown')}
              </h3>
              {stats.byRisk.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('No calibration data yet.')}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 pr-2 font-medium">
                          {isZh ? '等级' : 'Risk'}
                        </th>
                        <th className="py-2 pr-2 text-right font-medium">
                          {isZh ? '总数' : 'Total'}
                        </th>
                        <th className="py-2 pr-2 text-right font-medium">
                          Fast / Deep
                        </th>
                        <th className="py-2 pr-2 text-right font-medium">
                          {isZh ? '打回 / 人审 / 无发现' : 'Req / Hum / Clean'}
                        </th>
                        <th className="py-2 text-right font-medium">
                          {isZh ? '均耗' : 'Avg'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.byRisk.map((row) => (
                        <tr
                          key={row.riskLevel}
                          className="border-b border-border/50 last:border-0"
                        >
                          <td className="py-2 pr-2">
                            <span
                              className={`inline-flex rounded border px-1.5 py-0.5 font-mono text-[11px] ${RISK_BADGE_STYLE[row.riskLevel] || RISK_BADGE_STYLE.unknown}`}
                            >
                              {row.riskLevel}
                            </span>
                          </td>
                          <td className="py-2 pr-2 text-right font-medium">
                            {row.totalRuns}
                          </td>
                          <td className="py-2 pr-2 text-right text-muted-foreground">
                            {row.fastTrackRuns} / {row.deepTrackRuns}
                          </td>
                          <td className="py-2 pr-2 text-right">
                            <span className="text-rose-600 dark:text-rose-400">
                              {row.changesRequested}
                            </span>
                            {' / '}
                            <span className="text-amber-600 dark:text-amber-400">
                              {row.needsHumanReview}
                            </span>
                            {' / '}
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {row.noConfirmedFindings}
                            </span>
                          </td>
                          <td className="py-2 text-right text-muted-foreground">
                            {formatDuration(row.avgDurationSec)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-3 text-sm font-medium">
                {t('Daily review trend')}
              </h3>
              {stats.dailyTrend.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('No calibration data yet.')}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {stats.dailyTrend.slice(-14).map((d) => {
                    const widthPct = Math.max(
                      4,
                      Math.round((d.totalRuns / maxDaily) * 100),
                    );
                    const autoPct =
                      d.totalRuns > 0
                        ? Math.round((d.autoApproveEligible / d.totalRuns) * 100)
                        : 0;
                    return (
                      <div
                        key={d.day}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span className="w-20 shrink-0 font-mono text-[11px] text-muted-foreground">
                          {d.day.slice(5)}
                        </span>
                        <div className="h-4 flex-1 overflow-hidden rounded bg-muted/60">
                          <div
                            className="flex h-full overflow-hidden rounded bg-sky-500/70"
                            style={{ width: `${widthPct}%` }}
                          >
                            {autoPct > 0 && (
                              <div
                                className="h-full bg-emerald-500"
                                style={{ width: `${autoPct}%` }}
                              />
                            )}
                          </div>
                        </div>
                        <span className="w-20 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                          {d.totalRuns}
                          {d.autoApproveEligible > 0
                            ? ` (${d.autoApproveEligible}✓)`
                            : ''}
                        </span>
                      </div>
                    );
                  })}
                  <div className="pt-1 text-[11px] text-muted-foreground">
                    {isZh
                      ? '绿段：可自动放行 (auto_approve_eligible) · 蓝段：其余审查'
                      : 'Green: auto_approve_eligible · Blue: other reviews'}
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Drift Samples: Auto-Approve Eligible MRs Modified Before Merge */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-medium">
              {t('Auto-approve eligible MRs modified before merge')}
            </h3>
            {stats.driftSamples.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('No drift samples in this range.')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">MR</th>
                      <th className="py-2 pr-3 font-medium">
                        {isZh ? '等级' : 'Risk'}
                      </th>
                      <th className="py-2 pr-3 font-medium">
                        {isZh ? '已审 SHA → 合入 SHA' : 'Reviewed → Merged SHA'}
                      </th>
                      <th className="py-2 text-right font-medium">
                        {isZh ? '合入时间' : 'Merged at'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.driftSamples.map((item) => (
                      <tr
                        key={item.runId}
                        className="border-b border-border/50 last:border-0"
                      >
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-muted-foreground">
                              !{item.mrIid}
                            </span>
                            {item.mrUrl ? (
                              <a
                                href={item.mrUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
                              >
                                <span className="max-w-[340px] truncate">
                                  {item.mrTitle || item.repoPath}
                                </span>
                                <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                              </a>
                            ) : (
                              <span className="max-w-[340px] truncate font-medium">
                                {item.mrTitle || item.repoPath}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={`inline-flex rounded border px-1.5 py-0.5 font-mono text-[11px] ${RISK_BADGE_STYLE[item.riskLevel] || RISK_BADGE_STYLE.unknown}`}
                          >
                            {item.riskLevel}
                          </span>
                        </td>
                        <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground">
                          {shortSha(item.headSha)} →{' '}
                          {shortSha(item.mergedHeadSha)}
                        </td>
                        <td className="py-2 text-right text-muted-foreground">
                          {item.mrMergedAt
                            ? new Date(item.mrMergedAt).toLocaleString()
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
