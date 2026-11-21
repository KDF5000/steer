'use client';

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  ArrowLeft,
  Check,
  FileText,
  Info,
  Plus,
  Sparkles,
  Trash2,
  Wrench,
  Import,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import {
  steer,
  type SkillFileRecord,
  type SkillRecord,
} from '@/lib/steer-client';

function formValue(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// SkillDetailView is a full page rather than a dialog: a Skill package can
// contain many files, and browsing them needs the room.
export function SkillDetailView({
  skillId,
  onSkill,
  onBack,
  onNotice,
}: {
  skillId: string;
  onSkill: (skill: SkillRecord) => void;
  onBack: () => void;
  onNotice: (message: string) => void;
}) {
  const { t } = useI18n();
  const [skill, setSkill] = useState<SkillRecord | null>(null);
  const [files, setFiles] = useState<SkillFileRecord[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [tab, setTab] = useState<'files' | 'settings'>('files');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [addingFile, setAddingFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const newFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void steer
      .skill(skillId)
      .then((detail) => {
        if (cancelled) return;
        const nextFiles = detail.files?.length
          ? detail.files
          : [
              {
                path: 'SKILL.md',
                content: detail.content,
                encoding: 'text' as const,
              },
            ];
        setSkill(detail);
        setFiles(nextFiles);
        setSelectedPath(nextFiles[0]?.path || 'SKILL.md');
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : t('Could not load Skill files.'),
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, t]);

  useEffect(() => {
    if (addingFile) newFileInputRef.current?.focus();
  }, [addingFile]);

  const currentFile = files.find((file) => file.path === selectedPath);

  const updateFile = (content: string) => {
    setFiles((items) =>
      items.map((file) =>
        file.path === selectedPath
          ? { ...file, content, size: content.length }
          : file,
      ),
    );
    setDirty(true);
  };

  const addFile = () => {
    const path = newFilePath.trim().replace(/^\.?\//, '');
    if (!path) return;
    if (files.some((file) => file.path.toLowerCase() === path.toLowerCase())) {
      setError(`File “${path}” already exists.`);
      return;
    }
    setError('');
    setFiles((items) => [
      ...items,
      { path, content: '', encoding: 'text', size: 0 },
    ]);
    setSelectedPath(path);
    setNewFilePath('');
    setAddingFile(false);
    setDirty(true);
  };

  const removeFile = (path: string) => {
    if (path.toLowerCase() === 'skill.md') return;
    setFiles((items) => items.filter((file) => file.path !== path));
    if (selectedPath === path) {
      setSelectedPath(files.find((file) => file.path !== path)?.path || '');
    }
    setDirty(true);
  };

  const saveFiles = async () => {
    if (!skill || saving) return;
    setSaving(true);
    setError('');
    try {
      const saved = await steer.updateSkillFiles(skill.id, files);
      setSkill(saved);
      setFiles(saved.files || []);
      setDirty(false);
      onSkill(saved);
      onNotice(t('Skill files saved.'));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t('Could not save Skill files.'),
      );
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!skill || saving) return;
    setSaving(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      let saved = await steer.updateSkill(skill.id, {
        name: formValue(data, 'name'),
        description: formValue(data, 'description'),
        content: formValue(data, 'content'),
      });
      if (dirty && files.length) {
        // Instructions are authoritative for SKILL.md, so a settings save must
        // not be overwritten by a stale SKILL.md draft from the Files tab.
        const instructions = formValue(data, 'content');
        const nextFiles = files.map((file) =>
          file.path.toLowerCase() === 'skill.md'
            ? { ...file, content: instructions, size: instructions.length }
            : file,
        );
        saved = await steer.updateSkillFiles(saved.id, nextFiles);
        setFiles(saved.files || []);
        setDirty(false);
      }
      setSkill(saved);
      onSkill(saved);
      onNotice(t('Skill saved.'));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not save Skill.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="ws-page ws-skill-page">
        <output className="ws-content-state">{t('Loading…')}</output>
      </div>
    );
  }

  if (!skill) {
    return (
      <div className="ws-page ws-skill-page">
        <button type="button" className="ws-skill-back" onClick={onBack}>
          <ArrowLeft aria-hidden="true" /> {t('Back to Assets')}
        </button>
        <p className="ws-form-error" role="alert">
          {error || t('Skill not found.')}
        </p>
      </div>
    );
  }

  return (
    <div className="ws-page ws-skill-page">
      <header className="ws-skill-page-header">
        <button type="button" className="ws-skill-back" onClick={onBack}>
          <ArrowLeft aria-hidden="true" /> {t('Back to Assets')}
        </button>
        <div className="ws-skill-title">
          <span className="ws-asset-icon skill">
            <Wrench />
          </span>
          <div>
            <h1>{skill.name}</h1>
            <p>{skill.description || t('Reusable Agent instructions.')}</p>
            <span className="ws-skill-source">
              {skill.sourceKind === 'agentbuddy' ? (
                <>
                  <Import /> AgentBuddy
                </>
              ) : skill.sourceKind === 'url' ? (
                <>
                  <Import /> {t('Imported')}
                </>
              ) : (
                <>
                  <Sparkles /> {t('Created in Steer')}
                </>
              )}
              <em>
                {files.length} {t('files')}
              </em>
            </span>
          </div>
        </div>
      </header>

      <div className="ws-skill-detail-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'files'}
          className={tab === 'files' ? 'active' : undefined}
          onClick={() => setTab('files')}
        >
          {t('Files')}
          <span>{files.length || undefined}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'settings'}
          className={tab === 'settings' ? 'active' : undefined}
          onClick={() => setTab('settings')}
        >
          {t('Settings')}
        </button>
      </div>

      {tab === 'files' ? (
        <>
          <div className="ws-skill-files ws-skill-files-page">
            <aside>
              <header>
                <span>
                  {files.length} {t('files')}
                </span>
                <button
                  type="button"
                  aria-label={t('Add file')}
                  onClick={() => setAddingFile(true)}
                >
                  <Plus />
                </button>
              </header>
              {addingFile && (
                <div className="ws-skill-file-add">
                  <input
                    ref={newFileInputRef}
                    value={newFilePath}
                    placeholder="e.g. scripts/check.sh"
                    onChange={(event) => setNewFilePath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addFile();
                      }
                      if (event.key === 'Escape') {
                        setAddingFile(false);
                        setNewFilePath('');
                      }
                    }}
                  />
                  <button
                    type="button"
                    aria-label={t('Add file')}
                    onClick={addFile}
                  >
                    <Check />
                  </button>
                </div>
              )}
              <ul>
                {files.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      className={file.path === selectedPath ? 'active' : undefined}
                      onClick={() => setSelectedPath(file.path)}
                    >
                      <FileText />
                      <span>{file.path}</span>
                      {file.encoding === 'base64' && <em>{t('binary')}</em>}
                    </button>
                    {file.path.toLowerCase() !== 'skill.md' && (
                      <button
                        type="button"
                        className="ws-skill-file-remove"
                        aria-label={`${t('Delete file')} ${file.path}`}
                        onClick={() => removeFile(file.path)}
                      >
                        <Trash2 />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </aside>
            <section>
              {currentFile ? (
                currentFile.encoding === 'base64' ? (
                  <div className="ws-skill-binary">
                    <Info />
                    <div>
                      <strong>{t('Binary file')}</strong>
                      <p>
                        {fileSize(currentFile.size ?? 0)} ·{' '}
                        {t(
                          'Binary files are stored as-is and cannot be edited here.',
                        )}
                      </p>
                    </div>
                  </div>
                ) : (
                  <textarea
                    value={currentFile.content}
                    onChange={(event) => updateFile(event.target.value)}
                    aria-label={currentFile.path}
                    spellCheck={false}
                  />
                )
              ) : (
                <div className="ws-skill-binary">
                  <FileText />
                  <div>
                    <strong>{t('Select a file')}</strong>
                    <p>{t('Choose a file to view its contents.')}</p>
                  </div>
                </div>
              )}
            </section>
          </div>
          {error && (
            <p className="ws-form-error" role="alert">
              {error}
            </p>
          )}
          <footer className="ws-skill-detail-footer">
            <span className="ws-form-hint">
              {dirty
                ? t('You have unsaved file changes.')
                : t('SKILL.md is the entry point used by Agents.')}
            </span>
            <Button
              type="button"
              onClick={() => void saveFiles()}
              disabled={saving || !dirty}
            >
              {saving ? 'Saving…' : t('Save files')}
            </Button>
          </footer>
        </>
      ) : (
        <form
          key={skill.updatedAt}
          onSubmit={saveSettings}
          className="ws-skill-settings-form"
        >
          <label>
            Name
            <input name="name" defaultValue={skill.name} />
          </label>
          <label>
            Description
            <input name="description" defaultValue={skill.description} />
          </label>
          <label>
            Instructions
            <textarea name="content" defaultValue={skill.content} rows={14} />
          </label>
          <p className="ws-form-hint">
            {t(
              'Instructions are stored as SKILL.md. Use the Files tab to edit other files.',
            )}
          </p>
          {error && (
            <p className="ws-form-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : t('Save')}
            </Button>
          </footer>
        </form>
      )}
    </div>
  );
}
