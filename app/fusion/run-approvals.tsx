'use client';

import { useRef, useState } from 'react';
import { Check, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RunApproval } from '@/lib/domain';
import { useI18n } from '@/lib/i18n';
import { steer } from '@/lib/steer-client';

export function RunApprovals({
  runId,
  approvals,
  readOnly,
  onSessionAllowed,
}: {
  runId: string;
  approvals: RunApproval[];
  readOnly?: boolean;
  onSessionAllowed?: () => void;
}) {
  return (
    <div className="ws-run-approvals">
      {approvals.map((approval) => (
        <Approval
          key={`${runId}:${approval.id}`}
          runId={runId}
          approval={approval}
          readOnly={readOnly}
          onSessionAllowed={onSessionAllowed}
        />
      ))}
    </div>
  );
}

function Approval({
  runId,
  approval,
  readOnly,
  onSessionAllowed,
}: {
  runId: string;
  approval: RunApproval;
  readOnly?: boolean;
  onSessionAllowed?: () => void;
}) {
  const { t } = useI18n();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState<
    'allow_once' | 'allow_session' | 'reject' | null
  >(null);
  const [error, setError] = useState('');
  const decide = async (
    decision: 'allow_once' | 'allow_session' | 'reject',
  ) => {
    if (busyRef.current || resolved || readOnly) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await steer.resolveRunApproval(runId, approval.id, decision);
      setResolved(decision);
      if (decision === 'allow_session') onSessionAllowed?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Approval could not be submitted. Try again.'),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      className="ws-run-approval"
      aria-label={t('Tool approval')}
      aria-busy={busy}
    >
      <p className="ws-run-approval-label">
        <ShieldAlert aria-hidden="true" />
        <span>
          {t(
            approval.command
              ? 'Approve command execution'
              : 'Approve tool execution',
          )}
        </span>
      </p>
      <pre className="ws-run-approval-command">
        {approval.command || approval.prompt}
      </pre>
      {resolved ? (
        <output className="ws-run-approval-status" aria-live="polite">
          {t(
            resolved === 'allow_session'
              ? 'Session auto-approval enabled. Resuming…'
              : resolved === 'allow_once'
                ? 'Approved once. Resuming…'
                : 'Rejected. Notifying Agent…',
          )}
        </output>
      ) : readOnly ? (
        <p className="ws-run-approval-note">
          {t('A workspace member must handle this approval.')}
        </p>
      ) : (
        <div className="ws-run-approval-actions">
          <Button
            type="button"
            size="sm"
            className="ws-approval-btn-allow"
            disabled={busy || !approval.allowOnce}
            onClick={() => void decide('allow_once')}
          >
            <Check aria-hidden="true" />
            {t(busy ? 'Submitting…' : 'Allow once')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ws-approval-btn-session"
            disabled={busy || !approval.allowOnce}
            onClick={() => void decide('allow_session')}
            title={t(
              'Automatically approve tool requests in this conversation, including later turns. Delegated conversations are separate.',
            )}
          >
            <ShieldCheck aria-hidden="true" />
            {t('Always allow in this conversation')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ws-approval-btn-reject"
            disabled={busy}
            onClick={() => void decide('reject')}
          >
            <X aria-hidden="true" />
            {t('Reject')}
          </Button>
        </div>
      )}
      {!resolved && !approval.allowOnce && (
        <p>
          {t('This tool does not offer permission for a single execution.')}
        </p>
      )}
      {error && (
        <p role="alert" className="ws-form-error">
          {error}
        </p>
      )}
    </section>
  );
}

export function SessionApprovalPolicy({
  sessionId,
  readOnly,
  onDisabled,
}: {
  sessionId: string;
  readOnly?: boolean;
  onDisabled: () => void;
}) {
  const { t } = useI18n();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const disable = async () => {
    if (busyRef.current || readOnly) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await steer.disableSessionAutoApproval(sessionId);
      onDisabled();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Approval policy could not be updated. Try again.'),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="ws-session-approval-policy">
      <div
        className="ws-session-approval-pill"
        title={t(
          'Automatically approve tool requests in this conversation, including later turns. Delegated conversations are separate.',
        )}
      >
        <ShieldCheck aria-hidden="true" />
        <span>{t('Auto-approval enabled for this conversation')}</span>
        {!readOnly && (
          <button
            type="button"
            className="ws-session-approval-close"
            disabled={busy}
            aria-label={t('Turn off')}
            title={t('Turn off')}
            onClick={() => void disable()}
          >
            {busy ? (
              <span>{t('Updating…')}</span>
            ) : (
              <>
                <X aria-hidden="true" />
                <span>{t('Turn off')}</span>
              </>
            )}
          </button>
        )}
      </div>
      {error && (
        <p className="ws-form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
