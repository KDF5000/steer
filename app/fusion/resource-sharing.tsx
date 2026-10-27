'use client';

import { useState, type ReactNode } from 'react';
import {
  Users,
  Folder,
  Eye,
  MessageSquare,
  X,
  ChevronRight,
  LoaderCircle,
} from 'lucide-react';
import { useSidebar } from '@/components/ui/sidebar';
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
  type ProjectRecord,
  type ResourceShare,
  type AuthUser,
} from '@/lib/steer-client';
export type SharingTarget = {
  kind: 'session' | 'agent';
  id: string;
  name: string;
  context?: string;
  viewOnly?: boolean;
};

export function AgentTable({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="ws-agents-table">
      <div className="ws-table-head">
        <span>{t('Agent')}</span>
        <span>{t('Runtime')}</span>
        <span>{t('Model')}</span>
        <span>{t('Status')}</span>
        <span />
      </div>
      {children}
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1
    ? (Array.from(parts[0])[0] + Array.from(parts.at(-1)!)[0]).toUpperCase()
    : Array.from(name)[0]?.toUpperCase() || '?';
}
export function CollaborationAvatars({
  members,
  user,
  onClick,
}: {
  members: ResourceShare[];
  user: AuthUser | null;
  onClick: () => void;
}) {
  const { t } = useI18n();
  if (!members.length) return null;
  return (
    <button
      type="button"
      className="ws-collaboration-avatars"
      onClick={onClick}
      aria-label={t('View collaborators')}
      title={members
        .map(
          (m) =>
            `${m.recipientName || m.recipientEmail} · ${t(m.status === 'pending' ? 'Pending invitation' : m.permission === 'execute' ? 'Can collaborate' : 'View only')}`,
        )
        .join('\n')}
    >
      <span className="ws-collaboration-avatar">
        {initials(user?.displayName || '')}
      </span>
      {members.slice(0, 2).map((m) => (
        <span
          key={m.id}
          className={`ws-collaboration-avatar ${m.status === 'pending' ? 'pending' : ''}`}
        >
          {initials(m.recipientName || m.recipientEmail)}
        </span>
      ))}
      {members.length > 2 && (
        <span className="ws-collaboration-avatar">+{members.length - 2}</span>
      )}
    </button>
  );
}
export function CollaborationTree({
  shares,
  onOpen,
  compact = false,
  activeId,
}: {
  shares: ResourceShare[];
  onOpen: (share: ResourceShare) => Promise<void>;
  compact?: boolean;
  activeId?: string;
}) {
  const { t } = useI18n();
  const { isMobile, setOpenMobile } = useSidebar();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState('');
  const [pendingShare, setPendingShare] = useState<ResourceShare | null>(null);
  const [error, setError] = useState('');
  const groups = new Map<string, ResourceShare[]>();
  shares
    .filter((s) => s.kind === 'session' && !s.owned)
    .forEach((s) => {
      const key = JSON.stringify([
        s.ownerId || s.ownerName,
        s.projectId || s.projectSource || s.projectName || '',
      ]);
      groups.set(key, [...(groups.get(key) || []), s]);
    });
  return (
    <div className={`ws-collaboration-tree ${compact ? 'compact' : ''}`}>
      {!groups.size && (
        <p className="ws-collaborative-project-state">
          {t('No collaborative projects yet.')}
        </p>
      )}
      {[...groups].map(([key, list], index) => {
        const open =
          expanded[key] ??
          (!compact || index === 0 || list.some((s) => s.id === activeId));
        return (
          <section key={key}>
            <button
              type="button"
              className="ws-collaboration-project"
              aria-expanded={open}
              onClick={() =>
                setExpanded((current) => ({ ...current, [key]: !open }))
              }
            >
              <ChevronRight className={open ? 'is-open' : ''} />
              <Folder />
              <strong>{list[0].projectName || t('No project')}</strong>
              <span>{list[0].ownerName}</span>
              {!compact && (
                <small>
                  {t('{count} conversations', { count: list.length })}
                </small>
              )}
            </button>
            {open && (
              <div className="ws-collaboration-sessions">
                {list.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`ws-collaboration-session ${s.id === activeId ? 'is-active' : ''}`}
                    title={s.resourceName}
                    disabled={Boolean(busy)}
                    onClick={async () => {
                      if (s.status === 'pending') {
                        setError('');
                        setPendingShare(s);
                        return;
                      }
                      setBusy(s.id);
                      setError('');
                      try {
                        await onOpen(s);
                        if (compact && isMobile) setOpenMobile(false);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusy('');
                      }
                    }}
                  >
                    <span>{s.resourceName}</span>
                    {busy === s.id ? (
                      <LoaderCircle className="animate-spin" />
                    ) : s.status === 'pending' ? (
                      <small className="pending">
                        {t('Pending invitation')}
                      </small>
                    ) : !compact ? (
                      <small>
                        {t(
                          s.permission === 'execute'
                            ? 'Can collaborate'
                            : 'View only',
                        )}
                      </small>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
      <Dialog
        open={Boolean(pendingShare)}
        onOpenChange={(open) => !busy && !open && setPendingShare(null)}
      >
        <DialogContent className="ws-sharing-dialog">
          <DialogTitle>{t('Accept conversation invitation')}</DialogTitle>
          <DialogDescription>
            {pendingShare?.ownerName} ·{' '}
            {pendingShare?.projectName || t('No project')}
          </DialogDescription>
          <p className="ws-sharing-invited-title">
            {pendingShare?.resourceName}
          </p>
          <p className="ws-sharing-note">
            {t(
              pendingShare?.permission === 'execute'
                ? 'You can view messages and start tasks with this conversation’s Agent.'
                : 'You can view this conversation’s messages and results.',
            )}
          </p>
          {error && (
            <p role="alert" className="ws-form-error">
              {error}
            </p>
          )}
          <div className="ws-form-actions">
            <Button
              variant="outline"
              disabled={Boolean(busy)}
              onClick={() => setPendingShare(null)}
            >
              {t('Cancel')}
            </Button>
            <Button
              disabled={Boolean(busy)}
              onClick={async () => {
                if (!pendingShare) return;
                setBusy(pendingShare.id);
                setError('');
                try {
                  await onOpen(pendingShare);
                  setPendingShare(null);
                  if (compact && isMobile) setOpenMobile(false);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy('');
                }
              }}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : null}
              {t('Accept and open')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {error && (
        <p role="alert" className="ws-form-error">
          {error}
        </p>
      )}
    </div>
  );
}
export function SharedAgentsList({
  shares,
  onUse,
  onRefresh,
}: {
  shares: ResourceShare[];
  onUse: (share: ResourceShare) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<ResourceShare | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const incoming = shares.filter((s) => s.kind === 'agent' && !s.owned);
  return (
    <>
      {!incoming.length ? (
        <p className="ws-sharing-empty">
          {t('Agents shared with you will appear here.')}
        </p>
      ) : (
        <>
          <p className="ws-system-note ws-shared-agent-note">
            <Users />
            {t(
              'Agents are authorized by their providers. Using one creates a private conversation in your workspace.',
            )}
          </p>
          <AgentTable>
            {incoming.map((s) => (
              <div key={s.id}>
                <span className="ws-agent-avatar">
                  {initials(s.resourceName)}
                </span>
                <span>
                  <strong>{s.resourceName}</strong>
                  <small>
                    {s.agentRole ? s.agentRole + ' · ' : ''}
                    {s.ownerName} · {s.projectName}
                  </small>
                </span>
                <span>{s.runtimeLabel || s.runtimeProvider}</span>
                <span>{s.model || t('Runtime default')}</span>
                <span className="ws-agent-state">
                  <i
                    className={s.status === 'pending' ? 'ws-agent-pending' : ''}
                  />
                  {t(
                    s.status === 'pending' ? 'Pending invitation' : 'Available',
                  )}
                </span>
                <span className="ws-agent-actions">
                  <button
                    type="button"
                    aria-label={t('View capability')}
                    title={t('View capability')}
                    onClick={() => {
                      setSelected(s);
                      setError('');
                    }}
                  >
                    <Eye />
                  </button>
                  <button
                    type="button"
                    aria-label={t(
                      s.status === 'pending'
                        ? 'Accept Agent invitation'
                        : 'Start chatting',
                    )}
                    title={t(
                      s.status === 'pending'
                        ? 'Accept Agent invitation'
                        : 'Start chatting',
                    )}
                    onClick={() => {
                      setSelected(s);
                      setError('');
                    }}
                  >
                    <MessageSquare />
                  </button>
                </span>
              </div>
            ))}
          </AgentTable>
        </>
      )}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => !busy && !open && setSelected(null)}
      >
        <DialogContent className="ws-sharing-dialog">
          <DialogTitle>{selected?.resourceName}</DialogTitle>
          <DialogDescription>
            {t(
              'Accepting adds the authorized project to your workspace. Click the project to start a private conversation.',
            )}
          </DialogDescription>
          {selected && (
            <>
              <dl className="ws-sharing-scope">
                <dt>{t('Provided by')}</dt>
                <dd>{selected.ownerName}</dd>
                <dt>{t('Project')}</dt>
                <dd>{selected.projectName}</dd>
                <dt>{t('Runtime')}</dt>
                <dd>{selected.runtimeLabel || selected.runtimeProvider}</dd>
                <dt>{t('Directory or repository')}</dt>
                <dd>{selected.projectSource}</dd>
                <dt>{t('Execution directory')}</dt>
                <dd>
                  {t(
                    selected.projectKind === 'git'
                      ? 'Independent Git worktree'
                      : 'Authorized local directory',
                  )}
                </dd>
                <dt>{t('Concurrent tasks')}</dt>
                <dd>{selected.maxConcurrency}</dd>
              </dl>
              <p className="ws-sharing-note">
                {t(
                  'The provider manages the machine and native execution logs. This does not share your workspace or conversation.',
                )}
              </p>
              {error && (
                <p role="alert" className="ws-form-error">
                  {error}
                </p>
              )}
              <div className="ws-form-actions">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await steer.revokeResourceShare(selected.id);
                      await onRefresh();
                      setSelected(null);
                    } catch (e) {
                      setError(String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t('Decline or leave')}
                </Button>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      if (selected.status === 'pending') {
                        await steer.acceptResourceShare(selected.id);
                        await onRefresh();
                      } else {
                        await onUse(selected);
                      }
                      setSelected(null);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? <LoaderCircle className="animate-spin" /> : null}
                  {t(
                    selected.status === 'pending'
                      ? 'Accept Agent invitation'
                      : 'Start chatting',
                  )}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ResourceSharingDialog({
  target,
  shares,
  projects,
  user,
  onClose,
  onRefresh,
}: {
  target: SharingTarget | null;
  shares: ResourceShare[];
  projects: ProjectRecord[];
  user: AuthUser | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'view' | 'execute'>(
    target?.viewOnly ? 'view' : 'execute',
  );
  const [project, setProject] = useState('');
  const [capacity, setCapacity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const members = shares.filter(
    (s) => s.owned && s.kind === target?.kind && s.resourceId === target?.id,
  );
  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(open) => !busy && !open && onClose()}
    >
      <DialogContent className="ws-sharing-dialog ws-sharing-invite-dialog">
        <DialogTitle>
          {t(target?.kind === 'agent' ? 'Share Agent' : 'Invite collaboration')}
        </DialogTitle>
        <DialogDescription
          className="ws-sharing-summary"
          title={
            target?.context
              ? `${target.context} · ${target.name}`
              : target?.name
          }
        >
          {target?.context
            ? `${target.context} · ${target.name}`
            : target?.name}
        </DialogDescription>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!target) return;
            if (
              members.some(
                (s) =>
                  s.recipientEmail.toLowerCase() === email.trim().toLowerCase(),
              )
            ) {
              setError(t('This person is already invited.'));
              return;
            }
            void act(async () => {
              await steer.inviteResource(target.kind, target.id, {
                email,
                permission: target.kind === 'agent' ? 'execute' : permission,
                ...(target.kind === 'agent'
                  ? { projectId: project, maxConcurrency: capacity }
                  : {}),
              });
              setEmail('');
            });
          }}
        >
          {target?.kind === 'agent' && (
            <div className="ws-agent-share-scope">
              <label>
                {t('Authorized project')}
                <select
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  required
                  disabled={busy}
                >
                  <option value="">{t('Select project')}</option>
                  {projects
                    .filter((p) => !p.deletedAt && !p.sharedAgentGrantId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t('Concurrent tasks')}
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={capacity}
                  onChange={(e) => setCapacity(Number(e.target.value))}
                  disabled={busy}
                />
              </label>
            </div>
          )}
          <div className="ws-sharing-invite-row">
            <label>
              {t('Email')}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="colleague@example.com"
                disabled={busy}
              />
            </label>
            <label>
              {t('Permission')}
              <select
                value={target?.kind === 'agent' ? 'execute' : permission}
                onChange={(e) =>
                  setPermission(e.target.value as 'view' | 'execute')
                }
                disabled={busy || target?.kind === 'agent'}
              >
                {!target?.viewOnly && (
                  <option value="execute">
                    {t(
                      target?.kind === 'agent'
                        ? 'Available'
                        : 'Can collaborate',
                    )}
                  </option>
                )}
                {target?.kind !== 'agent' && (
                  <option value="view">{t('View only')}</option>
                )}
              </select>
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : t('Invite')}
            </Button>
          </div>
        </form>
        <p className="ws-sharing-note">
          {t(
            target?.kind === 'agent'
              ? 'Git projects use independent worktrees. Local projects use the authorized directory.'
              : target?.viewOnly
                ? 'This conversation can only be shared for viewing.'
                : 'Collaborators can start Agent tasks in this conversation.',
          )}
        </p>
        {error && (
          <p role="alert" className="ws-form-error">
            {error}
          </p>
        )}
        <div className="ws-sharing-member-heading">
          <span>{t('Collaborators')}</span>
          <small>{t('{count} people', { count: members.length + 1 })}</small>
        </div>
        <div className="ws-sharing-members">
          <div className="ws-sharing-owner">
            <span className="ws-collaboration-avatar">
              {initials(user?.displayName || '')}
            </span>
            <span>
              <strong>
                {user?.displayName} <small>{t('You')}</small>
              </strong>
              <small>{user?.email}</small>
            </span>
            <small>{t('Owner')}</small>
          </div>
          {members.map((s) => (
            <div key={s.id}>
              <span
                className={`ws-collaboration-avatar ${s.status === 'pending' ? 'pending' : ''}`}
              >
                {initials(s.recipientName || s.recipientEmail)}
              </span>
              <span>
                <strong>
                  {s.recipientName || s.recipientEmail.split('@')[0]}{' '}
                  {s.status === 'pending' && (
                    <small>{t('Pending invitation')}</small>
                  )}
                </strong>
                <small>{s.recipientEmail}</small>
                {target?.kind === 'agent' && <small>{s.projectName}</small>}
              </span>
              {target?.kind === 'session' ? (
                <select
                  aria-label={`${t('Permission')} ${s.recipientEmail}`}
                  value={s.permission}
                  disabled={busy}
                  onChange={(e) =>
                    void act(() =>
                      steer.updateResourceShare(
                        s.id,
                        e.target.value as 'view' | 'execute',
                      ),
                    )
                  }
                >
                  {!target.viewOnly && (
                    <option value="execute">{t('Can collaborate')}</option>
                  )}
                  <option value="view">{t('View only')}</option>
                </select>
              ) : (
                <small>{t('Available')}</small>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${t('Revoke access')} ${s.recipientEmail}`}
                title={t('Revoke access')}
                disabled={busy}
                onClick={() => void act(() => steer.revokeResourceShare(s.id))}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
        <p className="ws-sharing-note">
          {t('Only this resource is shared. Your workspace stays private.')}
        </p>
      </DialogContent>
    </Dialog>
  );
}

export function SharedSessionAccessDialog({
  share,
  onClose,
  onLeave,
}: {
  share: ResourceShare | null;
  onClose: () => void;
  onLeave: () => Promise<void>;
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
        <DialogTitle>{t('Conversation access')}</DialogTitle>
        <DialogDescription>{share?.resourceName}</DialogDescription>
        {share && (
          <dl className="ws-sharing-scope">
            <dt>{t('Provided by')}</dt>
            <dd>{share.ownerName}</dd>
            <dt>{t('Permission')}</dt>
            <dd>
              {t(
                share.permission === 'execute'
                  ? 'Can collaborate'
                  : 'View only',
              )}
            </dd>
            <dt>{t('Project')}</dt>
            <dd>{share.projectName || t('No project')}</dd>
            <dt>{t('Runtime')}</dt>
            <dd>{share.runtimeLabel || share.runtimeProvider}</dd>
          </dl>
        )}
        <p className="ws-sharing-note">
          {t(
            'Access is limited to this conversation and its authorized execution environment.',
          )}
        </p>
        {error && (
          <p role="alert" className="ws-form-error">
            {error}
          </p>
        )}
        <div className="ws-form-actions">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('Close')}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onLeave();
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : null}
            {t('Leave sharing')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
