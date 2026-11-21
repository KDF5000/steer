'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { FlaskConical, GitBranch } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/lib/i18n';

const changeEvent = 'steer-labs-changed';

function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(changeEvent, listener);
  };
}

export function useWorkspaceLabs(userID?: string, workspaceID?: string) {
  const key =
    userID && workspaceID
      ? `steer.labs.codebase-review.v1:${userID}:${workspaceID}`
      : '';
  const read = useCallback(() => {
    if (!key) return false;
    try {
      return window.localStorage.getItem(key) === 'true';
    } catch {
      return false;
    }
  }, [key]);
  const enabled = useSyncExternalStore(subscribe, read, () => false);
  const setEnabled = useCallback(
    (next: boolean) => {
      if (!key) return false;
      try {
        window.localStorage.setItem(key, String(next));
        window.dispatchEvent(new Event(changeEvent));
        return true;
      } catch {
        return false;
      }
    },
    [key],
  );
  return { enabled, setEnabled };
}

export function LabsView({
  enabled,
  onToggle,
  onOpen,
}: {
  enabled: boolean;
  onToggle: (next: boolean) => void;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="ws-page ws-settings-page ws-labs-page">
      <div className="ws-page-intro">
        <div>
          <span>{t('System').toUpperCase()}</span>
          <h1>{t('Labs')}</h1>
          <p>
            {t('Enable experimental features to try them in this workspace.')}
          </p>
        </div>
        <FlaskConical className="ws-labs-heading-icon" aria-hidden="true" />
      </div>
      <section className="ws-settings-group">
        <div className="ws-settings-heading">
          <h2>{t('Experimental features')}</h2>
          <p>
            {t(
              'Preferences are saved for this account and workspace in this browser.',
            )}
          </p>
        </div>
        <div className="ws-settings-list">
          <div className="ws-settings-row ws-labs-feature">
            <GitBranch aria-hidden="true" />
            <div className="ws-settings-copy">
              <strong id="labs-review-label">
                {t('Automated code review')}
              </strong>
              <p id="labs-review-description">
                {t('Connect Codebase and fetch merge requests.')}
              </p>
              <p className="ws-labs-stage-description">
                {t('Merge requests are synced; reviews run on demand.')}
              </p>
            </div>
            <Switch
              aria-labelledby="labs-review-label"
              aria-describedby="labs-review-description"
              checked={enabled}
              onCheckedChange={onToggle}
            />
          </div>
        </div>
        {enabled && (
          <button className="ws-labs-open" onClick={onOpen}>
            {t('Open automation')}
          </button>
        )}
      </section>
    </div>
  );
}
