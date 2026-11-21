'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { GitBranch } from 'lucide-react';
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
}: {
  enabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="ws-page ws-settings-page ws-labs-page">
      <div className="ws-page-intro">
        <div>
          <span>{t('System').toUpperCase()}</span>
          <h1>{t('Labs')}</h1>
          <p>
            {t('Manage experimental features available in this workspace.')}
          </p>
        </div>
      </div>
      <section aria-label={t('Experimental features')}>
        <div className="ws-settings-list ws-labs-feature-list">
          <div className="ws-settings-row ws-labs-feature">
            <GitBranch aria-hidden="true" />
            <div className="ws-settings-copy">
              <label id="labs-review-label" htmlFor="labs-review-toggle">
                {t('Automated code review')}
              </label>
              <p id="labs-review-description">
                {t(
                  'Configure MR review workflows in Automation, with manual or webhook triggers.',
                )}
              </p>
            </div>
            <Switch
              id="labs-review-toggle"
              aria-labelledby="labs-review-label"
              aria-describedby="labs-review-description"
              checked={enabled}
              onCheckedChange={onToggle}
            />
          </div>
        </div>
        <p className="ws-labs-preference-note">
          {t(
            'Enabling adds Automation to the sidebar. Disabling hides the entry without pausing review workflows.',
          )}
        </p>
        <p className="ws-labs-scope-note">
          {t(
            'Preferences are saved for this account and workspace in this browser.',
          )}
        </p>
      </section>
    </div>
  );
}
