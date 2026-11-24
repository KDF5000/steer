'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import {
  steer,
  type CodebaseRunRecord,
  type ResourceShare,
  type SharedWorkflowRecord,
  type SharedWorkflowRun,
} from '@/lib/steer-client';

export const SHARED_WORKFLOW_PREFIX = 'share:';

export function sharedWorkflowKey(shareId: string) {
  return `${SHARED_WORKFLOW_PREFIX}${shareId}`;
}

export function sharedWorkflowIdFromKey(value: string) {
  return value.startsWith(SHARED_WORKFLOW_PREFIX)
    ? value.slice(SHARED_WORKFLOW_PREFIX.length)
    : '';
}

export function toSharedRunRecord(
  run: SharedWorkflowRun,
  share: ResourceShare,
): CodebaseRunRecord {
  return {
    ...run,
    workspaceId: '',
    workflowId: sharedWorkflowKey(share.id),
    repoId: sharedWorkflowKey(share.id),
    repoPath: share.projectSource || '',
    taskId: '',
    model: '',
    reasoningEffort: '',
  };
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1
    ? (Array.from(parts[0])[0] + Array.from(parts.at(-1)!)[0]).toUpperCase()
    : Array.from(name)[0]?.toUpperCase() || '?';
}

export function SharedWorkflowInvitations({
  invitations,
  onRefresh,
  onNotice,
}: {
  invitations: ResourceShare[];
  onRefresh: () => Promise<void>;
  onNotice?: (message: string) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [declining, setDeclining] = useState<ResourceShare | null>(null);

  if (!invitations.length && !declining) return null;

  const act = async (share: ResourceShare, accept: boolean) => {
    if (busy) return;
    setBusy(share.id);
    setError('');
    try {
      if (accept) {
        await steer.acceptResourceShare(share.id);
        onNotice?.(t('Accepted "{name}".', { name: share.resourceName }));
      } else {
        await steer.revokeResourceShare(share.id);
      }
      await onRefresh();
      setDeclining(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      {error && !declining && (
        <p className="ws-form-error" role="alert">
          {error}
        </p>
      )}
      {invitations.map((share) => (
        <section className="ws-workflow-invitation" key={share.id}>
          <span className="ws-collaboration-avatar">
            {initials(share.ownerName)}
          </span>
          <div className="ws-workflow-invitation-copy">
            <strong>
              {t('{name} invited you to view {workflow}', {
                name: share.ownerName,
                workflow: share.resourceName,
              })}
            </strong>
            <p>
              {share.projectSource}
              {share.workspaceName ? ` · ${share.workspaceName}` : ''} ·{' '}
              {t('Workflow read only')}
            </p>
          </div>
          <div className="ws-workflow-invitation-actions">
            <Button
              variant="ghost"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => {
                setError('');
                setDeclining(share);
              }}
            >
              {t('Decline')}
            </Button>
            <Button
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => void act(share, true)}
            >
              {busy === share.id ? (
                <LoaderCircle className="animate-spin" />
              ) : null}
              {t(busy === share.id ? 'Accepting…' : 'Accept invitation')}
            </Button>
          </div>
        </section>
      ))}
      <Dialog
        open={Boolean(declining)}
        onOpenChange={(open) => !busy && !open && setDeclining(null)}
      >
        <DialogContent className="ws-sharing-dialog">
          <DialogTitle>{t('Decline invitation?')}</DialogTitle>
          <DialogDescription>
            {declining
              ? `${declining.ownerName} · ${declining.projectSource || declining.resourceName}`
              : ''}
          </DialogDescription>
          <p className="ws-sharing-note">
            {t(
              'After declining, this invitation will be removed. Ask the owner to invite you again if needed.',
            )}
          </p>
          {error && (
            <p className="ws-form-error" role="alert">
              {error}
            </p>
          )}
          <div className="ws-form-actions">
            <Button
              variant="outline"
              disabled={Boolean(busy)}
              onClick={() => setDeclining(null)}
            >
              {t('Cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={Boolean(busy)}
              onClick={() => declining && void act(declining, false)}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : null}
              {t(busy ? 'Declining…' : 'Decline')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SharedWorkflowInfoDialog({
  share,
  onClose,
}: {
  share: ResourceShare | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<SharedWorkflowRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!share) return;
    let stopped = false;
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (stopped) return;
      setLoading(true);
      setError('');
      setData(null);
    });
    steer
      .sharedWorkflow(share.id, controller.signal)
      .then((record) => {
        if (!stopped) setData(record);
      })
      .catch((e) => {
        if (!stopped) setError(errorText(e));
      })
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [share]);

  const workflow = data?.workflow;

  return (
    <Dialog open={Boolean(share)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="ws-sharing-dialog">
        <DialogTitle>
          {workflow?.name || share?.resourceName || t('Workflow information')}
        </DialogTitle>
        <DialogDescription>
          {share
            ? `${t('Shared by {name}', { name: share.ownerName })}${share.workspaceName ? ` · ${share.workspaceName}` : ''}`
            : ''}
        </DialogDescription>
        {loading ? (
          <div className="ws-automation-skeleton" aria-label={t('Loading…')}>
            <div />
            <div />
          </div>
        ) : error ? (
          <p className="ws-form-error" role="alert">
            {error}
          </p>
        ) : (
          <dl className="ws-sharing-scope">
            <dt>{t('Repository')}</dt>
            <dd>{workflow?.repoPath || share?.projectSource || '—'}</dd>
            {workflow && (
              <>
                <dt>{t('Status')}</dt>
                <dd>{t(workflow.enabled ? 'Enabled' : 'Paused')}</dd>
                <dt>{t('Trigger')}</dt>
                <dd>
                  {t(
                    workflow.triggerWebhook
                      ? 'Webhook + manual'
                      : 'Manual only',
                  )}
                </dd>
                <dt>{t('Report')}</dt>
                <dd>
                  {t(
                    workflow.reportEnabled
                      ? 'MR writeback on'
                      : 'Steer results only',
                  )}
                </dd>
              </>
            )}
            <dt>{t('Permission')}</dt>
            <dd>
              {t('View merge requests, run records and linked conversations')}
            </dd>
          </dl>
        )}
        <p className="ws-sharing-note ws-workflow-info-note">
          <LockKeyhole aria-hidden="true" />
          {t('Contact the owner to re-run reviews or change this workflow.')}
        </p>
        <div className="ws-form-actions">
          <Button variant="outline" onClick={onClose}>
            {t('Done')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LeaveSharedWorkflowDialog({
  share,
  onClose,
  onLeft,
  onRefresh,
  onNotice,
}: {
  share: ResourceShare | null;
  onClose: () => void;
  onLeft?: (shareId: string) => void;
  onRefresh: () => Promise<void>;
  onNotice?: (message: string) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <Dialog
      open={Boolean(share)}
      onOpenChange={(open) => !busy && !open && onClose()}
    >
      <DialogContent className="ws-sharing-dialog">
        <DialogTitle>{t('Leave workflow sharing?')}</DialogTitle>
        <DialogDescription>
          {share
            ? `${share.resourceName}${share.projectSource ? ` · ${share.projectSource}` : ''}`
            : ''}
        </DialogDescription>
        <p className="ws-sharing-note">
          {t(
            'You will no longer be able to view this workflow and its results.',
          )}
        </p>
        {error && (
          <p className="ws-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="ws-form-actions">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              if (!share || busy) return;
              setBusy(true);
              setError('');
              try {
                await steer.revokeResourceShare(share.id);
                onLeft?.(share.id);
                await onRefresh();
                onNotice?.(t('Left "{name}".', { name: share.resourceName }));
                onClose();
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : null}
            {t(busy ? 'Leaving…' : 'Leave sharing')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
