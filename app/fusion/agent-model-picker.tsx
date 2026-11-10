'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Search,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useIsMobile } from '@/hooks/use-mobile';
import { useI18n } from '@/lib/i18n';
import type { AgentProfile } from '@/lib/domain';

export type AgentModelRuntime = {
  provider: string;
  runtimeId: string;
  models: string[];
  defaultModel: string;
};

export function AgentModelPicker({
  agent,
  agents,
  modelOverride,
  runtimes,
  runtimeRestricted = false,
  disabled = false,
  agentLocked = false,
  onSelect,
}: {
  agent: AgentProfile;
  agents: AgentProfile[];
  modelOverride: string | null;
  runtimes: AgentModelRuntime[];
  runtimeRestricted?: boolean;
  disabled?: boolean;
  agentLocked?: boolean;
  onSelect: (agentId: string, model: string | null) => void;
}) {
  const { t } = useI18n();
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const modelPanel = useRef<HTMLDivElement>(null);
  const agentPanel = useRef<HTMLDivElement>(null);
  const effectiveDefault = (item: AgentProfile) => {
    if (item.model && item.model !== 'Runtime default') return item.model;
    return runtimeFor(item)?.defaultModel || t('Runtime default');
  };
  const runtimeFor = (item: AgentProfile) =>
    runtimes.find(
      (runtime) =>
        runtime.provider === item.runtimeProvider &&
        (!item.runtimeId || item.runtimeId === runtime.runtimeId),
    );
  const currentModel = modelOverride || effectiveDefault(agent);
  const preview = agents.find((item) => item.id === previewId);
  const unavailable = (item: AgentProfile) =>
    (agentLocked && item.id !== agent.id) ||
    (runtimeRestricted && !runtimeFor(item));
  const previewRuntime = preview ? runtimeFor(preview) : undefined;
  const previewDefault = preview ? effectiveDefault(preview) : '';
  const models = [
    ...new Set([
      ...(previewRuntime?.models || []),
      ...(previewRuntime?.defaultModel ? [previewRuntime.defaultModel] : []),
      ...(preview?.model && preview.model !== 'Runtime default'
        ? [preview.model]
        : []),
      ...(preview?.id === agent.id && modelOverride ? [modelOverride] : []),
    ]),
  ].filter((model) => model.toLowerCase().includes(query.toLowerCase()));
  const selected = (id: string, model: string | null) => {
    onSelect(id, model);
    setOpen(false);
    setPreviewId(null);
    setQuery('');
  };
  const showModels = (id: string, focus = false) => {
    setActiveAgentId(id);
    if (previewId !== id) setQuery('');
    setPreviewId(id);
    if (focus)
      requestAnimationFrame(() =>
        modelPanel.current
          ?.querySelector<HTMLButtonElement>('button[data-model-choice]')
          ?.focus(),
      );
  };
  const back = () => {
    const id = previewId;
    setPreviewId(null);
    setQuery('');
    requestAnimationFrame(() =>
      agentPanel.current
        ?.querySelector<HTMLButtonElement>(`button[data-agent-models="${id}"]`)
        ?.focus(),
    );
  };
  const onKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key === 'ArrowLeft' &&
      modelPanel.current?.contains(event.target as Node)
    ) {
      event.preventDefault();
      back();
      return;
    }
    if (event.key === 'Escape' && previewId) {
      event.preventDefault();
      event.stopPropagation();
      back();
      return;
    }
    if (
      !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) ||
      (event.target as HTMLElement).tagName === 'INPUT'
    )
      return;
    const panel = modelPanel.current?.contains(event.target as Node)
      ? modelPanel.current
      : agentPanel.current;
    const buttons = [
      ...(panel?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ||
        []),
    ];
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : event.key === 'ArrowDown'
            ? (index + 1) % buttons.length
            : (index - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next);
        setActiveAgentId(next ? agent.id : null);
        if (!next) {
          setPreviewId(null);
          setQuery('');
        }
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            className="ws-composer-agent ws-composer-agent-model"
            disabled={disabled}
            aria-label={t('Select Agent and model')}
            title={`${agent.name} · ${currentModel}`}
          />
        }
      >
        <span className="ws-agent-avatar" aria-hidden="true">
          {agent.name[0]}
        </span>
        <span className="ws-agent-model-label">
          <span>{agent.name}</span>
          <span className="ws-agent-model-dot">·</span>
          <span className="ws-agent-model-value">{currentModel}</span>
        </span>
        <ChevronDown aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className={`ws-agent-model-popup${preview ? ' has-models' : ''}${mobile ? ' is-mobile' : ''}`}
        onKeyDown={onKeyboard}
        initialFocus={() => {
          const selectedAgent =
            agentPanel.current?.querySelector<HTMLButtonElement>(
              'button[data-agent-selected="true"]:not(:disabled)',
            );
          selectedAgent?.scrollIntoView({
            block: 'nearest',
            inline: 'nearest',
          });
          return selectedAgent || false;
        }}
      >
        <div
          className="ws-agent-picker-pane"
          ref={agentPanel}
          hidden={mobile && Boolean(preview)}
        >
          <div className="ws-agent-picker-options">
            {agents.map((item) => {
              const blocked = unavailable(item);
              return (
                <div
                  className={`ws-agent-picker-row${activeAgentId === item.id ? ' is-active' : ''}`}
                  key={item.id}
                >
                  <button
                    type="button"
                    className="ws-agent-picker-choice"
                    disabled={blocked}
                    data-agent-selected={item.id === agent.id || undefined}
                    onFocus={() => {
                      setActiveAgentId(item.id);
                      if (previewId) showModels(item.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowRight' && !blocked) {
                        event.preventDefault();
                        showModels(item.id, true);
                      }
                    }}
                    onClick={() =>
                      selected(
                        item.id,
                        item.id === agent.id ? modelOverride : null,
                      )
                    }
                  >
                    <span className="ws-agent-avatar" aria-hidden="true">
                      {item.name[0]}
                    </span>
                    <span>
                      <strong>
                        <span className="ws-agent-picker-name">
                          {item.name}
                        </span>
                        {item.id === agent.id && <Check aria-hidden="true" />}
                      </strong>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ws-agent-model-sub-trigger"
                    data-agent-models={item.id}
                    disabled={blocked}
                    aria-label={`${t('Select model')} · ${item.name}`}
                    aria-expanded={previewId === item.id}
                    onFocus={() => {
                      setActiveAgentId(item.id);
                      if (previewId) showModels(item.id);
                    }}
                    onClick={() => showModels(item.id, !mobile)}
                  >
                    <ChevronRight aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        {preview && (
          <div className="ws-model-picker-pane" ref={modelPanel}>
            {mobile && (
              <button
                className="ws-model-picker-back"
                type="button"
                onClick={back}
              >
                <ChevronLeft aria-hidden="true" />
                {t('Back to Agents')}
              </button>
            )}
            <label className="ws-model-picker-search">
              <Search aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('Search models…')}
                aria-label={t('Search models…')}
              />
            </label>
            <div className="ws-model-picker-options">
              <button
                type="button"
                data-model-choice
                aria-pressed={preview.id === agent.id && modelOverride === null}
                onClick={() => selected(preview.id, null)}
              >
                <span>
                  <strong>{t('Follow Agent default')}</strong>
                  <small>{previewDefault}</small>
                </span>
                {preview.id === agent.id && modelOverride === null && (
                  <Check aria-hidden="true" />
                )}
              </button>
              <hr />
              {models.map((model) => (
                <button
                  type="button"
                  key={model}
                  data-model-choice
                  aria-pressed={
                    preview.id === agent.id && modelOverride === model
                  }
                  onClick={() => selected(preview.id, model)}
                >
                  <Cpu aria-hidden="true" />
                  <span>
                    {model}
                    {model === previewDefault && (
                      <small className="ws-model-default-badge">
                        {t('Default')}
                      </small>
                    )}
                  </span>
                  {preview.id === agent.id && modelOverride === model && (
                    <Check aria-hidden="true" />
                  )}
                </button>
              ))}
              {!models.length && (
                <p className="ws-model-picker-empty">
                  {t(
                    query
                      ? 'No matching models'
                      : 'No model list reported by this Runtime.',
                  )}
                </p>
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
