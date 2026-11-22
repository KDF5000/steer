'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Copy, Webhook } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { steer, type CodebaseWebhookRecord } from '@/lib/steer-client';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

export function CodebaseWebhookSettings({
  onStatusChange,
}: {
  onStatusChange?: (enabled: boolean) => void;
} = {}) {
  const { t } = useI18n();
  const labelID = useId();
  const [settings, setSettings] = useState<CodebaseWebhookRecord | null>(null);
  const [origin, setOrigin] = useState(() =>
    typeof window === 'undefined' ? '' : window.location.origin,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const action = useRef<AbortController | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    const controller = new AbortController();
    steer
      .codebaseWebhook(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setSettings(value);
          onStatusChangeRef.current?.(Boolean(value?.enabled));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            'Webhook settings could not be loaded. Update the server and try again.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      action.current?.abort();
    };
  }, []);

  let callbackURL = '';
  try {
    const address = new URL(origin.trim());
    if (
      ['https:', 'http:'].includes(address.protocol) &&
      !address.username &&
      !address.password &&
      address.pathname === '/' &&
      !address.search &&
      !address.hash &&
      settings
    ) {
      callbackURL = address.origin + settings.callbackPath;
    }
  } catch {
    /* The field reports an invalid address below. */
  }

  const save = async (enabled: boolean, rotate = false) => {
    if (saving) return;
    const controller = new AbortController();
    action.current?.abort();
    action.current = controller;
    setSaving(true);
    setError('');
    setCopied(false);
    try {
      const value = await steer.saveCodebaseWebhook(
        enabled,
        rotate,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setSettings(value);
        onStatusChangeRef.current?.(Boolean(value?.enabled));
        setRotateOpen(false);
      }
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  };

  return (
    <>
      <section className="ws-automation-setting-row">
        <div className="ws-automation-setting-icon">
          <Webhook aria-hidden="true" />
        </div>
        <div className="ws-automation-connection-copy">
          <div className="ws-automation-connection-heading">
            <strong id={labelID}>Webhook</strong>
            {!loading && (
              <span
                className={`ws-automation-connection-status${settings?.enabled ? ' is-connected' : ''}`}
              >
                {t(
                  settings
                    ? settings.enabled
                      ? 'Enabled'
                      : 'Disabled'
                    : 'Not configured',
                )}
              </span>
            )}
          </div>
          <p>{t('Configure a callback to receive Codebase events.')}</p>
        </div>
        {!loading && (
          <div className="ws-automation-actions">
            <button
              type="button"
              className="ws-automation-button"
              onClick={() => {
                setConfigOpen(true);
                setRotateOpen(false);
                setCopied(false);
                setError('');
              }}
            >
              {t(settings ? 'Edit Webhook' : 'Configure Webhook')}
            </button>
          </div>
        )}
      </section>
      {error && !configOpen && (
        <p className="ws-automation-error" role="alert">
          {t(error)}
        </p>
      )}
      <Dialog
        open={configOpen}
        onOpenChange={(open) => {
          if (!saving) {
            setConfigOpen(open);
            if (!open) setRotateOpen(false);
          }
        }}
      >
        <DialogContent className="ws-workspace-dialog ws-codebase-dialog">
          <DialogTitle>
            {t(
              rotateOpen
                ? 'Replace callback URL?'
                : settings
                  ? 'Edit Webhook'
                  : 'Configure Webhook',
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              rotateOpen
                ? 'The old callback URL will stop working. Update the URL in Codebase after replacing it.'
                : 'Configure a callback to receive Codebase events.',
            )}
          </DialogDescription>
          {rotateOpen ? (
            <>
              {error && (
                <p className="ws-automation-error" role="alert">
                  {t(error)}
                </p>
              )}
              <div className="ws-form-actions">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setRotateOpen(false)}
                >
                  {t('Cancel')}
                </button>
                <button
                  type="button"
                  className="ws-danger-button"
                  disabled={saving}
                  onClick={() => void save(settings?.enabled ?? true, true)}
                >
                  {t(saving ? 'Saving…' : 'Replace callback URL')}
                </button>
              </div>
            </>
          ) : (
            <>
              {settings ? (
                <div className="ws-codebase-webhook-fields">
                  <div className="ws-codebase-webhook-toggle">
                    <label htmlFor={`${labelID}-enabled`}>
                      {t('Enable Webhook')}
                    </label>
                    <Switch
                      id={`${labelID}-enabled`}
                      checked={settings.enabled}
                      disabled={saving}
                      onCheckedChange={(enabled) => void save(enabled)}
                    />
                  </div>
                  <label>
                    <span>{t('Callback server address')}</span>
                    <input
                      type="url"
                      aria-label={t('Callback server address')}
                      aria-describedby={`${labelID}-origin-help`}
                      value={origin}
                      onChange={(event) => {
                        setOrigin(event.target.value);
                        setCopied(false);
                      }}
                      placeholder="https://steer.example.com"
                    />
                    <small id={`${labelID}-origin-help`}>
                      {t(
                        'Use a Steer address that Codebase can reach. Localhost only works on this machine.',
                      )}
                    </small>
                  </label>
                  <label>
                    <span>{t('Callback URL')}</span>
                    <textarea
                      readOnly
                      rows={3}
                      value={callbackURL}
                      aria-label={t('Callback URL')}
                    />
                  </label>
                  {!callbackURL && (
                    <p className="ws-automation-error" role="alert">
                      {t(
                        'Enter an HTTP(S) server address without a path or credentials.',
                      )}
                    </p>
                  )}
                  <div className="ws-automation-actions">
                    <button
                      type="button"
                      className="ws-automation-button"
                      disabled={!callbackURL || saving}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(callbackURL);
                          setCopied(true);
                        } catch {
                          setError('Copy the link from the field.');
                        }
                      }}
                    >
                      <Copy aria-hidden="true" />
                      {t(copied ? 'Copied' : 'Copy callback URL')}
                    </button>
                    <button
                      type="button"
                      className="ws-automation-button is-danger-outline"
                      disabled={saving}
                      onClick={() => {
                        setError('');
                        setRotateOpen(true);
                      }}
                    >
                      {t('Replace callback URL')}
                    </button>
                  </div>
                  <p className="ws-codebase-webhook-instructions">
                    {t(
                      'Paste this URL into Codebase Webhook settings and select the MR events you want to receive.',
                    )}
                  </p>
                  <p className="ws-codebase-webhook-stage">
                    {t(
                      settings.enabled
                        ? 'Webhook is active. Workflows with Webhook trigger enabled will receive Codebase MR events.'
                        : 'Enable Webhook above so workflows with Webhook trigger enabled can receive Codebase MR events.',
                    )}
                  </p>
                </div>
              ) : (
                <p className="ws-codebase-webhook-instructions">
                  {t('Generate a callback URL to enable receiving events.')}
                </p>
              )}
              {error && (
                <p className="ws-automation-error" role="alert">
                  {t(error)}
                </p>
              )}
              <div className="ws-form-actions">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setConfigOpen(false)}
                >
                  {t('Close')}
                </button>
                {!settings && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void save(true)}
                  >
                    {t(saving ? 'Saving…' : 'Generate callback URL')}
                  </button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
