'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Plus, Search, X } from 'lucide-react';

import { useI18n } from '@/lib/i18n';
import type { SkillRecord } from '@/lib/steer-client';

export function AgentSkillPicker({
  skills,
  initialSelectedIDs,
  selectedIDs: controlledIDs,
  onSelectionChange,
  disabled = false,
  maxSelected = Infinity,
  hint,
}: {
  skills: SkillRecord[];
  initialSelectedIDs: string[];
  selectedIDs?: string[];
  onSelectionChange?: (ids: string[]) => void;
  disabled?: boolean;
  maxSelected?: number;
  hint?: string;
}) {
  const { t } = useI18n();
  const [localIDs, setLocalIDs] = useState<string[]>(() =>
    initialSelectedIDs.filter((id) => skills.some((skill) => skill.id === id)),
  );
  const selectedIDs = controlledIDs ?? localIDs;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);
  const searchRef = useRef<HTMLInputElement>(null);
  const atLimit = selectedIDs.length >= maxSelected;

  const changeSelection = (ids: string[]) => {
    if (disabled) return;
    if (controlledIDs === undefined) setLocalIDs(ids);
    onSelectionChange?.(ids);
  };

  const selectedSkills = useMemo(
    () =>
      selectedIDs
        .map((id) => skills.find((skill) => skill.id === id))
        .filter((skill): skill is SkillRecord => Boolean(skill)),
    [selectedIDs, skills],
  );
  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return skills.filter(
      (skill) =>
        !selectedIDs.includes(skill.id) &&
        (!needle || skill.name.toLowerCase().includes(needle)),
    );
  }, [query, selectedIDs, skills]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const addSkill = (id: string) => {
    if (disabled || atLimit || selectedIDs.includes(id)) return;
    changeSelection([...selectedIDs, id]);
    setQuery('');
    setVisibleCount(50);
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  return (
    <div className="ws-skill-field">
      {selectedIDs.map((id) => (
        <input key={id} type="hidden" name="skills" value={id} />
      ))}
      <div className="ws-skill-head">
        <span className="ws-skill-title">{t('Skills')}</span>
        <span className="ws-skill-count">
          {selectedSkills.length
            ? t('{count} selected', { count: selectedSkills.length })
            : t('None selected')}
        </span>
      </div>
      <div className="ws-skill-tag-cloud">
        {selectedSkills.map((skill) => (
          <span key={skill.id} className="ws-skill-tag">
            <span title={skill.name}>{skill.name}</span>
            <button
              type="button"
              className="ws-skill-tag-remove"
              aria-label={`${t('Remove')} ${skill.name}`}
              disabled={disabled}
              onClick={() =>
                changeSelection(selectedIDs.filter((id) => id !== skill.id))
              }
            >
              <X />
            </button>
          </span>
        ))}
        <button
          type="button"
          className="ws-skill-tag ws-skill-tag-add"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled || atLimit || skills.length === 0}
          onClick={() => {
            setQuery('');
            setVisibleCount(50);
            setOpen(true);
          }}
        >
          <Plus />
          {t('Add Skill')}
        </button>
      </div>
      <p className="ws-skill-hint">
        {skills.length === 0
          ? t('Add Skills to the workspace library before selecting them here.')
          : atLimit
            ? t('You can select up to {count} Skills.', { count: maxSelected })
            : (hint ??
              t(
                'Relay installs selected instructions into this Agent’s remote workspace for every run.',
              ))}
      </p>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop
            className="ws-skill-picker-backdrop"
            forceRender
          />
          <DialogPrimitive.Popup
            initialFocus={searchRef}
            className="ws-skill-picker"
          >
            <DialogPrimitive.Title className="sr-only">
              {t('Search Skills')}
            </DialogPrimitive.Title>
            <search className="ws-skill-search">
              <Search aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={query}
                placeholder={t('Search Skills')}
                aria-label={t('Search Skills')}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setVisibleCount(50);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                  }
                }}
              />
            </search>
            <div className="ws-skill-picker-list">
              {atLimit && (
                <output className="ws-skill-picker-empty">
                  {t('You can select up to {count} Skills.', {
                    count: maxSelected,
                  })}
                </output>
              )}
              {candidates.length ? (
                candidates.slice(0, visibleCount).map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    disabled={disabled || atLimit}
                    onClick={() => addSkill(skill.id)}
                  >
                    <Plus />
                    <span title={skill.name}>{skill.name}</span>
                  </button>
                ))
              ) : (
                <div className="ws-skill-picker-empty">
                  {query.trim()
                    ? t('No matching Skills')
                    : t('All Skills added')}
                </div>
              )}
              {candidates.length > visibleCount && (
                <button
                  type="button"
                  className="ws-skill-picker-more"
                  onClick={() => setVisibleCount((count) => count + 50)}
                >
                  {t('Show more Skills')}
                </button>
              )}
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}
