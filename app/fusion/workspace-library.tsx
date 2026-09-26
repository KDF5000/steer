'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Archive,
  ArrowLeft,
  Bell,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Clock3,
  ExternalLink,
  FileText,
  Import,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  steer,
  type AgentActivityRecord,
  type ChatSessionRecord,
  type DocumentRecord,
  type NoteRecord,
  type SkillRecord,
  type WorkLogActivityRunRecord,
  type WorkLogEntryRecord,
  type WorkLogSummaryRecord,
  type WorkLogWeeklyRunRecord,
} from '@/lib/steer-client';

type Notice = (message: string) => void;
type AssignableAgent = {
  id: string;
  name: string;
  runtimeProvider?: string;
  runtimeId?: string | null;
};

const emptyNote = (): Omit<
  NoteRecord,
  'id' | 'workspaceId' | 'createdAt' | 'updatedAt'
> => ({
  title: '',
  content: '',
  tags: [],
  pinned: false,
  archived: false,
  reminderAt: null,
});

function formValue(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function friendlyDate(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString())
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function localDateTimeValue(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function WorkLogMarkdown({ children }: { children: string }) {
  return (
    <div className="ws-work-log-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export function AssetsView({
  skills,
  documents,
  agents,
  agentSkills,
  onSkills,
  onDocuments,
  onAgentSkills,
  onNotice,
}: {
  skills: SkillRecord[];
  documents: DocumentRecord[];
  agents: AssignableAgent[];
  agentSkills: Record<string, string[]>;
  onSkills: (items: SkillRecord[]) => void;
  onDocuments: (items: DocumentRecord[]) => void;
  onAgentSkills: (items: Record<string, string[]>) => void;
  onNotice: Notice;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'skills' | 'documents'>('skills');
  const [skillDialog, setSkillDialog] = useState(false);
  const [importDialog, setImportDialog] = useState(false);
  const [documentDialog, setDocumentDialog] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillRecord | null>(null);
  const [editingDocument, setEditingDocument] = useState<DocumentRecord | null>(
    null,
  );
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const saveSkill = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      const input = {
        name: formValue(data, 'name'),
        description: formValue(data, 'description'),
        content: formValue(data, 'content'),
      };
      const saved = editingSkill
        ? await steer.updateSkill(editingSkill.id, input)
        : await steer.createSkill(input);
      onSkills(
        editingSkill
          ? skills.map((item) => (item.id === saved.id ? saved : item))
          : [saved, ...skills],
      );
      const selectedAgents = new Set(data.getAll('agents').map(String));
      const nextAssignments = { ...agentSkills };
      const changedAssignments = agents.flatMap((agent) => {
        const current = agentSkills[agent.id] || [];
        const next = selectedAgents.has(agent.id)
          ? [...new Set([...current, saved.id])]
          : current.filter((id) => id !== saved.id);
        return current.length === next.length &&
          current.every((id, index) => id === next[index])
          ? []
          : [{ agent, next }];
      });
      const assignmentResults = await Promise.allSettled(
        changedAssignments.map(async ({ agent, next }) => {
          await steer.setAgentSkills(agent.id, next);
          nextAssignments[agent.id] = next;
          return agent.name;
        }),
      );
      onAgentSkills(nextAssignments);
      setSkillDialog(false);
      setEditingSkill(null);
      const failedAssignments = assignmentResults.filter(
        (result) => result.status === 'rejected',
      ).length;
      if (failedAssignments) {
        onNotice(
          `Skill saved, but ${failedAssignments} Agent assignment${failedAssignments === 1 ? '' : 's'} could not be updated.`,
        );
      } else {
        onNotice(
          selectedAgents.size
            ? 'Skill saved and assigned. Relay will install it into the Agent workspace on the next run.'
            : 'Skill saved.',
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not save Skill.',
      );
    } finally {
      setWorking(false);
    }
  };

  const importSkill = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setError('');
    try {
      const data = new FormData(event.currentTarget);
      const imported = await steer.importSkill(formValue(data, 'url'));
      onSkills([imported, ...skills]);
      setImportDialog(false);
      onNotice(
        'Skill imported. Configure it to choose which Agents receive it.',
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not import Skill.',
      );
    } finally {
      setWorking(false);
    }
  };

  const removeSkill = async (skill: SkillRecord) => {
    if (!window.confirm(`Delete “${skill.name}”?`)) return;
    try {
      await steer.deleteSkill(skill.id);
      onSkills(skills.filter((item) => item.id !== skill.id));
      onAgentSkills(
        Object.fromEntries(
          Object.entries(agentSkills).map(([agentID, ids]) => [
            agentID,
            ids.filter((id) => id !== skill.id),
          ]),
        ),
      );
      onNotice('Skill deleted.');
    } catch (reason) {
      onNotice(
        reason instanceof Error ? reason.message : 'Could not delete Skill.',
      );
    }
  };

  const saveDocument = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setError('');
    const data = new FormData(event.currentTarget);
    const input = {
      title: formValue(data, 'title'),
      url: formValue(data, 'url'),
      description: formValue(data, 'description'),
    };
    try {
      const saved = editingDocument
        ? await steer.updateDocument(editingDocument.id, input)
        : await steer.createDocument(input);
      onDocuments(
        editingDocument
          ? documents.map((item) => (item.id === saved.id ? saved : item))
          : [saved, ...documents],
      );
      setDocumentDialog(false);
      setEditingDocument(null);
      onNotice('Document link saved.');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not save document.',
      );
    } finally {
      setWorking(false);
    }
  };

  const removeDocument = async (document: DocumentRecord) => {
    if (!window.confirm(`Delete “${document.title}”?`)) return;
    try {
      await steer.deleteDocument(document.id);
      onDocuments(documents.filter((item) => item.id !== document.id));
      onNotice('Document link deleted.');
    } catch (reason) {
      onNotice(
        reason instanceof Error ? reason.message : 'Could not delete document.',
      );
    }
  };

  return (
    <div className="ws-page ws-library-page">
      <header className="ws-library-header">
        <div>
          <span className="ws-eyebrow">{t('Workspace library')}</span>
          <h1>{t('Assets')}</h1>
          <p>
            {t('Reusable instructions for Agents and reference links for you.')}
          </p>
        </div>
        <div className="ws-library-actions">
          {tab === 'skills' ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setError('');
                  setImportDialog(true);
                }}
              >
                <Import aria-hidden="true" /> {t('Import')}
              </Button>
              <Button
                onClick={() => {
                  setEditingSkill(null);
                  setError('');
                  setSkillDialog(true);
                }}
              >
                <Plus aria-hidden="true" /> {t('New skill')}
              </Button>
            </>
          ) : (
            <Button
              onClick={() => {
                setEditingDocument(null);
                setError('');
                setDocumentDialog(true);
              }}
            >
              <Plus aria-hidden="true" /> {t('Add document')}
            </Button>
          )}
        </div>
      </header>

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList className="ws-library-tabs">
          <TabsTrigger value="skills">
            <Wrench /> {t('Skills')} <span>{skills.length}</span>
          </TabsTrigger>
          <TabsTrigger value="documents">
            <BookOpen /> {t('Documents')} <span>{documents.length}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'skills' ? (
        skills.length ? (
          <div className="ws-skill-grid">
            {skills.map((skill) => {
              const assigned = agents.filter((agent) =>
                (agentSkills[agent.id] || []).includes(skill.id),
              );
              return (
                <article className="ws-skill-card" key={skill.id}>
                  <header>
                    <span className="ws-asset-icon skill">
                      <Wrench />
                    </span>
                    <button
                      type="button"
                      aria-label={`Delete ${skill.name}`}
                      onClick={() => void removeSkill(skill)}
                    >
                      <Trash2 />
                    </button>
                  </header>
                  <h2>{skill.name}</h2>
                  <p>{skill.description || 'Reusable Agent instructions.'}</p>
                  <div className="ws-skill-source">
                    {skill.sourceKind === 'url' ? (
                      <>
                        <Import /> Imported
                      </>
                    ) : (
                      <>
                        <Sparkles /> Created in Steer
                      </>
                    )}
                  </div>
                  <footer>
                    <span>
                      {assigned.length
                        ? assigned.map((agent) => agent.name).join(', ')
                        : 'Not assigned'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSkill(skill);
                        setError('');
                        setSkillDialog(true);
                      }}
                    >
                      {t('Configure')}
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="ws-library-empty">
            <span className="ws-asset-icon skill">
              <Wrench />
            </span>
            <h2>{t('Create your first Skill')}</h2>
            <p>
              Skills are reusable instructions installed into the selected
              Agent’s remote workspace by Relay.
            </p>
            <Button onClick={() => setSkillDialog(true)}>
              <Plus /> {t('New skill')}
            </Button>
          </div>
        )
      ) : documents.length ? (
        <div className="ws-document-links">
          {documents.map((document) => (
            <article key={document.id}>
              <span className="ws-asset-icon document">
                <FileText />
              </span>
              <div>
                <a
                  href={document.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {document.title}
                  <ExternalLink />
                </a>
                <p>{document.description || document.url}</p>
                <small>{new URL(document.url).hostname}</small>
              </div>
              <button
                type="button"
                aria-label={`Edit ${document.title}`}
                onClick={() => {
                  setEditingDocument(document);
                  setError('');
                  setDocumentDialog(true);
                }}
              >
                <MoreHorizontal />
              </button>
              <button
                type="button"
                aria-label={`Delete ${document.title}`}
                onClick={() => void removeDocument(document)}
              >
                <Trash2 />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="ws-library-empty">
          <span className="ws-asset-icon document">
            <BookOpen />
          </span>
          <h2>{t('Add a reference document')}</h2>
          <p>
            Save an external document as a simple link. Content indexing can be
            added later.
          </p>
          <Button onClick={() => setDocumentDialog(true)}>
            <Plus /> {t('Add document')}
          </Button>
        </div>
      )}

      <Dialog
        open={skillDialog}
        onOpenChange={(open) => {
          setSkillDialog(open);
          if (!open) setEditingSkill(null);
        }}
      >
        <DialogContent className="ws-library-dialog">
          <DialogTitle>
            {editingSkill ? t('Configure') : t('Create skill')}
          </DialogTitle>
          <DialogDescription>
            Relay materializes assigned Skills into the native instruction file
            on the Agent’s machine for every run.
          </DialogDescription>
          <form onSubmit={saveSkill}>
            <label>
              Name
              <input
                name="name"
                defaultValue={editingSkill?.name}
                placeholder="e.g. UI review"
              />
            </label>
            <label>
              Description
              <input
                name="description"
                defaultValue={editingSkill?.description}
                placeholder="When should the Agent use this Skill?"
              />
            </label>
            <label>
              Instructions
              <textarea
                name="content"
                defaultValue={editingSkill?.content}
                placeholder="Write the reusable instructions in Markdown…"
                rows={10}
              />
            </label>
            <fieldset>
              <legend>Install for Agents</legend>
              {agents.length ? (
                agents.map((agent) => (
                  <label className="ws-agent-skill-option" key={agent.id}>
                    <input
                      type="checkbox"
                      name="agents"
                      value={agent.id}
                      defaultChecked={
                        editingSkill
                          ? (agentSkills[agent.id] || []).includes(
                              editingSkill.id,
                            )
                          : false
                      }
                    />
                    <span className="ws-avatar">{agent.name[0]}</span>
                    <span>
                      <strong>{agent.name}</strong>
                      <small>
                        {agent.runtimeProvider} ·{' '}
                        {agent.runtimeId || 'Automatic Runtime'}
                      </small>
                    </span>
                  </label>
                ))
              ) : (
                <p className="ws-form-hint">
                  Create an Agent before assigning this Skill.
                </p>
              )}
            </fieldset>
            {error && (
              <p className="ws-form-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSkillDialog(false)}
              >
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={working}>
                {working ? 'Saving…' : t('Save')}
              </Button>
            </footer>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialog} onOpenChange={setImportDialog}>
        <DialogContent className="ws-library-dialog compact">
          <DialogTitle>{t('Import Skill')}</DialogTitle>
          <DialogDescription>
            Import a public SKILL.md from GitHub or GitLab. Review the
            instructions before assigning it to an Agent.
          </DialogDescription>
          <form onSubmit={importSkill}>
            <label>
              SKILL.md URL
              <input
                name="url"
                type="url"
                placeholder="https://github.com/owner/repo/blob/main/SKILL.md"
              />
            </label>
            {error && (
              <p className="ws-form-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <Button
                type="button"
                variant="outline"
                onClick={() => setImportDialog(false)}
              >
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={working}>
                {working ? 'Importing…' : t('Import')}
              </Button>
            </footer>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={documentDialog}
        onOpenChange={(open) => {
          setDocumentDialog(open);
          if (!open) setEditingDocument(null);
        }}
      >
        <DialogContent className="ws-library-dialog compact">
          <DialogTitle>
            {editingDocument ? 'Edit document' : t('Add document')}
          </DialogTitle>
          <DialogDescription>
            Save a link to an external document. Steer will not copy or index
            its content yet.
          </DialogDescription>
          <form onSubmit={saveDocument}>
            <label>
              Title
              <input
                name="title"
                defaultValue={editingDocument?.title}
                placeholder="Document title"
              />
            </label>
            <label>
              URL
              <input
                name="url"
                type="url"
                defaultValue={editingDocument?.url}
                placeholder="https://…"
              />
            </label>
            <label>
              Description
              <textarea
                name="description"
                defaultValue={editingDocument?.description}
                placeholder="Optional context"
                rows={3}
              />
            </label>
            {error && (
              <p className="ws-form-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDocumentDialog(false)}
              >
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={working}>
                {working ? 'Saving…' : t('Save')}
              </Button>
            </footer>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type NoteFilter = 'active' | 'pinned' | 'reminders' | 'archived';
type NoteDraft = ReturnType<typeof emptyNote>;

const noteDraft = (note: NoteRecord): NoteDraft => ({
  title: note.title,
  content: note.content,
  tags: note.tags,
  pinned: note.pinned,
  archived: note.archived,
  reminderAt: note.reminderAt,
});

function sameNote(a: NoteDraft, b: NoteDraft) {
  return (
    a.title === b.title &&
    a.content === b.content &&
    a.pinned === b.pinned &&
    a.archived === b.archived &&
    a.reminderAt === b.reminderAt &&
    a.tags.join('\n') === b.tags.join('\n')
  );
}

export function NotesView({
  notes,
  onNotes,
  onNotice,
}: {
  notes: NoteRecord[];
  onNotes: (items: NoteRecord[]) => void;
  onNotice: Notice;
}) {
  const initialNote = notes.find((note) => !note.archived);
  const [filter, setFilter] = useState<NoteFilter>('active');
  const [query, setQuery] = useState('');
  const [selectedID, setSelectedID] = useState(initialNote?.id || '');
  const [draft, setDraft] = useState(() =>
    initialNote ? noteDraft(initialNote) : emptyNote(),
  );
  const [creating, setCreating] = useState(!notes.length);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const selected = notes.find((note) => note.id === selectedID);
  const isDirty = creating
    ? Boolean(draft.title || draft.content || draft.tags.length)
    : Boolean(selected && !sameNote(draft, noteDraft(selected)));
  const tags = [...new Set(notes.flatMap((note) => note.tags))].sort();
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return notes
      .filter((note) => {
        if (filter === 'active' && note.archived) return false;
        if (filter === 'archived' && !note.archived) return false;
        if (filter === 'pinned' && (!note.pinned || note.archived))
          return false;
        if (filter === 'reminders' && (!note.reminderAt || note.archived))
          return false;
        return (
          !normalized ||
          `${note.title}\n${note.content}\n${note.tags.join(' ')}`
            .toLowerCase()
            .includes(normalized)
        );
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });
  }, [filter, notes, query]);

  const resetToNewNote = () => {
    setCreating(true);
    setSelectedID('');
    setDraft(emptyNote());
    setError('');
  };

  async function saveNote() {
    if (working) return false;
    if (!isDirty) return true;
    setWorking(true);
    setError('');
    try {
      const saved = creating
        ? await steer.createNote(draft)
        : await steer.updateNote(selectedID, draft);
      onNotes(
        creating
          ? [saved, ...notes]
          : notes.map((note) => (note.id === saved.id ? saved : note)),
      );
      setSelectedID(saved.id);
      setCreating(false);
      setDraft(noteDraft(saved));
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not save note.',
      );
      return false;
    } finally {
      setWorking(false);
    }
  }

  const startNote = async () => {
    if (isDirty && !(await saveNote())) return;
    resetToNewNote();
  };

  const openNote = async (note: NoteRecord) => {
    if (note.id === selectedID && !creating) return;
    if (isDirty && !(await saveNote())) return;
    setCreating(false);
    setSelectedID(note.id);
    setDraft(noteDraft(note));
    setError('');
  };

  const closeEditor = async () => {
    if (isDirty && !(await saveNote())) return;
    setCreating(false);
    setSelectedID('');
    setError('');
  };

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (isDirty) void saveNote();
      }
    };
    window.addEventListener('keydown', handleSaveShortcut);
    return () => window.removeEventListener('keydown', handleSaveShortcut);
  });

  useEffect(() => {
    if (!isDirty || working || error) return;
    const timer = window.setTimeout(() => void saveNote(), 900);
    return () => window.clearTimeout(timer);
  });

  useEffect(() => {
    const warnAboutUnsavedChanges = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warnAboutUnsavedChanges);
    return () =>
      window.removeEventListener('beforeunload', warnAboutUnsavedChanges);
  }, [isDirty]);

  const patchNote = async (note: NoteRecord, patch: Partial<NoteRecord>) => {
    try {
      const saved = await steer.updateNote(note.id, {
        title: draft.title,
        content: draft.content,
        tags: draft.tags,
        pinned: draft.pinned,
        archived: draft.archived,
        reminderAt: draft.reminderAt,
        ...patch,
      });
      onNotes(notes.map((item) => (item.id === saved.id ? saved : item)));
      setDraft(noteDraft(saved));
      if (patch.archived) {
        setSelectedID('');
        setCreating(false);
      }
    } catch (reason) {
      onNotice(
        reason instanceof Error ? reason.message : 'Could not update note.',
      );
    }
  };

  const deleteNote = async () => {
    if (
      !selected ||
      !window.confirm(`Delete “${selected.title || 'Untitled note'}”?`)
    )
      return;
    try {
      await steer.deleteNote(selected.id);
      onNotes(notes.filter((note) => note.id !== selected.id));
      setSelectedID('');
      onNotice('Note deleted.');
    } catch (reason) {
      onNotice(
        reason instanceof Error ? reason.message : 'Could not delete note.',
      );
    }
  };

  return (
    <div
      className={`ws-notes-layout ${creating || selected ? 'has-editor' : 'has-list'}`}
    >
      <aside className="ws-note-filters">
        <header>
          <h1>Notes</h1>
          <Button
            size="icon"
            onClick={() => void startNote()}
            aria-label="New note"
          >
            <Plus />
          </Button>
        </header>
        <nav>
          <button
            type="button"
            className={filter === 'active' ? 'active' : ''}
            onClick={() => setFilter('active')}
          >
            <FileText /> All notes{' '}
            <span>{notes.filter((note) => !note.archived).length}</span>
          </button>
          <button
            type="button"
            className={filter === 'pinned' ? 'active' : ''}
            onClick={() => setFilter('pinned')}
          >
            <Pin /> Pinned{' '}
            <span>
              {notes.filter((note) => note.pinned && !note.archived).length}
            </span>
          </button>
          <button
            type="button"
            className={filter === 'reminders' ? 'active' : ''}
            onClick={() => setFilter('reminders')}
          >
            <Bell /> Reminders{' '}
            <span>
              {notes.filter((note) => note.reminderAt && !note.archived).length}
            </span>
          </button>
          <button
            type="button"
            className={filter === 'archived' ? 'active' : ''}
            onClick={() => setFilter('archived')}
          >
            <Archive /> Archive{' '}
            <span>{notes.filter((note) => note.archived).length}</span>
          </button>
        </nav>
        {!!tags.length && (
          <section>
            <strong>Tags</strong>
            {tags.map((tag) => (
              <button
                type="button"
                key={tag}
                onClick={() => {
                  setFilter('active');
                  setQuery(tag);
                }}
              >
                #{tag}
              </button>
            ))}
          </section>
        )}
      </aside>

      <section className="ws-note-list">
        <div className="ws-note-list-heading">
          <div>
            <h2>{filter === 'active' ? 'All notes' : filter}</h2>
            <span>
              {filtered.length} {filtered.length === 1 ? 'note' : 'notes'}
            </span>
          </div>
          <Button
            size="icon"
            onClick={() => void startNote()}
            aria-label="New note"
          >
            <Plus />
          </Button>
        </div>
        <div className="ws-note-filter-pills" aria-label="Note filters">
          {(['active', 'pinned', 'reminders', 'archived'] as NoteFilter[]).map(
            (item) => (
              <button
                type="button"
                className={filter === item ? 'active' : ''}
                key={item}
                onClick={() => setFilter(item)}
              >
                {item === 'active' ? 'All' : item}
              </button>
            ),
          )}
        </div>
        <div className="ws-note-search">
          <Search />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notes"
            aria-label="Search notes"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <X />
            </button>
          )}
        </div>
        <button
          className="ws-note-quick"
          type="button"
          onClick={() => void startNote()}
        >
          <Plus /> Take a note…
        </button>
        <div className="ws-note-items">
          {filtered.map((note) => (
            <button
              type="button"
              className={note.id === selectedID ? 'selected' : ''}
              key={note.id}
              onClick={() => void openNote(note)}
            >
              <span>
                <strong>{note.title || 'Untitled note'}</strong>
                {note.pinned && <Pin />}
              </span>
              <p>{note.content || 'Empty note'}</p>
              <footer>
                {note.tags.slice(0, 2).map((tag) => (
                  <em key={tag}>#{tag}</em>
                ))}
                {note.reminderAt && <Bell aria-label="Reminder set" />}
                <time>{friendlyDate(note.updatedAt)}</time>
              </footer>
            </button>
          ))}
          {!filtered.length && (
            <div className="ws-note-list-empty">
              <FileText />
              <strong>
                {query ? 'No matching notes' : 'Nothing here yet'}
              </strong>
              <span>
                {query
                  ? 'Try a different word or clear your search.'
                  : 'Create a note to start capturing ideas.'}
              </span>
              {query ? (
                <button type="button" onClick={() => setQuery('')}>
                  Clear search
                </button>
              ) : (
                <button type="button" onClick={() => void startNote()}>
                  Create note
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <article className="ws-note-editor">
        {creating || selected ? (
          <>
            <header>
              <div className="ws-note-editor-actions">
                <button
                  className="ws-note-mobile-back"
                  title="Back to notes"
                  aria-label="Back to notes"
                  onClick={() => void closeEditor()}
                >
                  <ArrowLeft />
                </button>
                {selected && (
                  <>
                    <button
                      type="button"
                      title={draft.pinned ? 'Unpin' : 'Pin'}
                      aria-pressed={draft.pinned}
                      onClick={() => {
                        setDraft((current) => ({
                          ...current,
                          pinned: !current.pinned,
                        }));
                        void patchNote(selected, { pinned: !selected.pinned });
                      }}
                    >
                      <Pin className={draft.pinned ? 'filled' : ''} />
                    </button>
                    <button
                      type="button"
                      title={draft.archived ? 'Unarchive' : 'Archive'}
                      onClick={() => {
                        setDraft((current) => ({
                          ...current,
                          archived: !current.archived,
                        }));
                        void patchNote(selected, {
                          archived: !selected.archived,
                        });
                      }}
                    >
                      <Archive />
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      onClick={() => void deleteNote()}
                    >
                      <Trash2 />
                    </button>
                  </>
                )}
              </div>
              <div className="ws-note-save">
                <span className={isDirty ? 'unsaved' : ''}>
                  {working ? (
                    'Saving…'
                  ) : isDirty ? (
                    'Unsaved changes'
                  ) : (
                    <>
                      <Check /> Saved
                    </>
                  )}
                </span>
                <Button
                  onClick={() => void saveNote()}
                  disabled={working || !isDirty}
                >
                  Save
                  <kbd>
                    {typeof navigator !== 'undefined' &&
                    /Mac/.test(navigator.platform)
                      ? '⌘'
                      : 'Ctrl'}{' '}
                    S
                  </kbd>
                </Button>
              </div>
            </header>
            <div className="ws-note-fields">
              <input
                className="ws-note-title"
                value={draft.title}
                onChange={(event) => {
                  setError('');
                  setDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }));
                }}
                placeholder="Untitled note"
              />
              <textarea
                className="ws-note-content"
                value={draft.content}
                onChange={(event) => {
                  setError('');
                  setDraft((current) => ({
                    ...current,
                    content: event.target.value,
                  }));
                }}
                placeholder="Start writing…"
              />
            </div>
            <footer className="ws-note-meta">
              <label>
                <span>#</span>
                <input
                  value={draft.tags.join(', ')}
                  onChange={(event) => {
                    setError('');
                    setDraft((current) => ({
                      ...current,
                      tags: event.target.value
                        .split(',')
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    }));
                  }}
                  placeholder="Tags, comma separated"
                />
              </label>
              <label>
                <Bell />
                <input
                  type="datetime-local"
                  value={localDateTimeValue(draft.reminderAt)}
                  onChange={(event) => {
                    setError('');
                    setDraft((current) => ({
                      ...current,
                      reminderAt: event.target.value
                        ? new Date(event.target.value).toISOString()
                        : null,
                    }));
                  }}
                  aria-label="Reminder time"
                />
              </label>
              {draft.reminderAt && (
                <button
                  className="ws-note-clear-reminder"
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({ ...current, reminderAt: null }))
                  }
                >
                  <X /> Clear reminder
                </button>
              )}
              <span className="ws-note-ai-ready">
                <Sparkles /> AI-ready
              </span>
              <span className="ws-note-stats">
                <Clock3 />{' '}
                {draft.content.trim()
                  ? draft.content.trim().split(/\s+/).length
                  : 0}{' '}
                words
              </span>
            </footer>
            {error && (
              <p className="ws-form-error ws-note-error" role="alert">
                {error}
              </p>
            )}
          </>
        ) : (
          <div className="ws-note-empty">
            <FileText />
            <h2>Select a note</h2>
            <p>Choose a note from the list or create a new one.</p>
            <Button onClick={() => void startNote()}>
              <Plus /> New note
            </Button>
          </div>
        )}
      </article>
    </div>
  );
}

const dayKey = (value: Date | string) => {
  const date = typeof value === 'string' ? new Date(value) : value;
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

function startOfWeek(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const weekday = date.getDay() || 7;
  date.setDate(date.getDate() - weekday + 1);
  return date;
}

const formatLogDate = (key: string, locale?: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });

function weekNumber(date: Date) {
  const utc = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7));
  return Math.ceil(
    ((utc.getTime() - Date.UTC(utc.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7,
  );
}

export function WorkLogView({
  onNotice,
  draftKey,
  sessions,
}: {
  onNotice: Notice;
  draftKey: string;
  sessions: ChatSessionRecord[];
}) {
  const { language, t } = useI18n();
  const [restored] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem(draftKey) || '{}') as {
        draft?: string;
        activities?: AgentActivityRecord[];
        editingID?: string;
        editingContent?: string;
      };
    } catch {
      return {};
    }
  });
  const [entries, setEntries] = useState<WorkLogEntryRecord[]>([]);
  const [summaries, setSummaries] = useState<WorkLogSummaryRecord[]>([]);
  const [draft, setDraft] = useState(restored.draft || '');
  const [activities, setActivities] = useState<AgentActivityRecord[]>([]);
  const [draftActivities, setDraftActivities] = useState<AgentActivityRecord[]>(
    restored.activities || [],
  );
  const [activityRun, setActivityRun] =
    useState<WorkLogActivityRunRecord | null>(null);
  const [activityResult, setActivityResult] = useState('');
  const [editingID, setEditingID] = useState(restored.editingID || '');
  const [editingContent, setEditingContent] = useState(
    restored.editingContent || '',
  );
  const [deleteTarget, setDeleteTarget] = useState<WorkLogEntryRecord | null>(
    null,
  );
  const [collecting, setCollecting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [workingLabel, setWorkingLabel] = useState('');
  const [weekMode, setWeekMode] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [weeklyRun, setWeeklyRun] = useState<
    (WorkLogWeeklyRunRecord & { periodStart: string }) | null
  >(null);
  const [visibleDays, setVisibleDays] = useState(7);
  const [loadedHistoryDays, setLoadedHistoryDays] = useState(42);
  const [hasEarlierHistory, setHasEarlierHistory] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const [openDays, setOpenDays] = useState(() => new Set([dayKey(new Date())]));
  const today = dayKey(new Date());
  const weekStart = startOfWeek(new Date());
  weekStart.setDate(weekStart.getDate() + weekOffset * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekStartKey = dayKey(weekStart);
  const activityRunId = activityRun?.runId;
  const activityRunStatus = activityRun?.status;
  const weeklyRunId = weeklyRun?.runId;
  const weeklyRunStatus = weeklyRun?.status;
  const weeklyRunPeriodStart = weeklyRun?.periodStart;
  useLayoutEffect(() => {
    const textarea = draftRef.current;
    if (!textarea) return;
    if (!draft) {
      textarea.style.height = '';
      return;
    }
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    let stored = false;
    try {
      if (draft || editingID)
        window.localStorage.setItem(
          draftKey,
          JSON.stringify({
            draft,
            activities: draftActivities,
            editingID,
            editingContent,
          }),
        );
      else window.localStorage.removeItem(draftKey);
      stored = true;
    } catch {
      /* Browser storage may be unavailable. Keep the in-memory draft. */
    }
    const guard = (event: BeforeUnloadEvent) => {
      if (!stored && (draft || editingID)) event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [draft, draftActivities, draftKey, editingID, editingContent]);
  const activityRange = () => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  };

  useEffect(() => {
    const since = new Date();
    since.setDate(since.getDate() - 42);
    void steer
      .workLog(since.toISOString())
      .then((data) => {
        setEntries(data.entries);
        setSummaries(data.summaries);
        setHasEarlierHistory(data.hasEarlier);
      })
      .catch((reason) =>
        onNotice(
          reason instanceof Error ? reason.message : 'Could not load work log.',
        ),
      )
      .finally(() => setLoading(false));
  }, [onNotice]);

  useEffect(() => {
    const range = activityRange();
    void steer
      .workLogActivityRun(range.from, range.to)
      .then((result) => {
        if (!result.run) return;
        setActivityRun(result.run);
        setActivities(result.activities);
        if (result.run.status === 'succeeded' && result.run.summary)
          setActivityResult(result.run.summary);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (
      !activityRunId ||
      !activityRunStatus ||
      ['succeeded', 'failed', 'cancelled'].includes(activityRunStatus)
    )
      return;
    const runId = activityRunId;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await steer.run(runId);
        if (cancelled) return;
        setActivityRun((current) =>
          current?.runId === runId
            ? {
                ...current,
                status: result.run.status,
                summary: result.content || null,
                error: result.error || null,
              }
            : current,
        );
        if (result.run.status === 'succeeded')
          setActivityResult(result.content.trim());
      } catch {
        // A transient status request should not discard a durable background run.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activityRunId, activityRunStatus]);

  useEffect(() => {
    if (!weekMode) return;
    let cancelled = false;
    void steer
      .weeklySummaryRun(weekStartKey)
      .then(({ run }) => {
        if (!cancelled && run)
          setWeeklyRun({ ...run, periodStart: weekStartKey });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [weekMode, weekStartKey]);

  useEffect(() => {
    if (
      !weeklyRunId ||
      !weeklyRunStatus ||
      !weeklyRunPeriodStart ||
      ['failed', 'cancelled'].includes(weeklyRunStatus)
    )
      return;
    const runId = weeklyRunId;
    const periodStart = weeklyRunPeriodStart;
    let cancelled = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      let finalizing = false;
      try {
        const result = await steer.run(runId);
        if (cancelled) return;
        if (result.run.status === 'succeeded') {
          finalizing = true;
          const content = result.content.trim();
          if (!content)
            throw new Error('The system Agent returned an empty result.');
          const saved = await steer.saveWorkLogSummary({
            periodKind: 'week',
            periodStart,
            content,
            runId,
          });
          if (cancelled) return;
          setSummaries((current) => [
            saved,
            ...current.filter(
              (item) =>
                !(
                  item.periodKind === 'week' && item.periodStart === periodStart
                ),
            ),
          ]);
          setWeeklyRun((current) =>
            current?.runId === runId ? null : current,
          );
          onNotice('Weekly summary updated.');
          return;
        }
        setWeeklyRun((current) =>
          current?.runId === runId
            ? current.status === result.run.status &&
              current.summary === (result.content || null) &&
              current.error === (result.error || null)
              ? current
              : {
                  ...current,
                  status: result.run.status,
                  summary: result.content || null,
                  error: result.error || null,
                }
            : current,
        );
      } catch (reason) {
        if (!cancelled && finalizing)
          onNotice(
            reason instanceof Error
              ? reason.message
              : 'Could not finish the weekly summary.',
          );
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [onNotice, weeklyRunId, weeklyRunPeriodStart, weeklyRunStatus]);

  const grouped = useMemo(() => {
    const result = new Map<string, WorkLogEntryRecord[]>();
    entries.forEach((entry) => {
      const key = dayKey(entry.occurredAt);
      result.set(key, [...(result.get(key) || []), entry]);
    });
    return result;
  }, [entries]);

  const days = useMemo(
    () =>
      Array.from({ length: visibleDays }, (_, index) => {
        const date = new Date();
        date.setHours(12, 0, 0, 0);
        date.setDate(date.getDate() - index);
        return dayKey(date);
      }).filter((key) => (grouped.get(key) || []).length > 0),
    [grouped, visibleDays],
  );

  const hasEarlierEntries =
    visibleDays < loadedHistoryDays || hasEarlierHistory;

  const loadEarlierEntries = async () => {
    if (loadingEarlier) return;
    if (visibleDays < loadedHistoryDays) {
      setVisibleDays((value) => Math.min(loadedHistoryDays, value + 7));
      return;
    }
    if (!hasEarlierHistory) return;
    setLoadingEarlier(true);
    const nextHistoryDays = loadedHistoryDays + 42;
    const since = new Date();
    since.setDate(since.getDate() - nextHistoryDays);
    try {
      const data = await steer.workLog(since.toISOString());
      setEntries((current) => [
        ...new Map(
          [...current, ...data.entries].map((entry) => [entry.id, entry]),
        ).values(),
      ]);
      setSummaries((current) => [
        ...new Map(
          [...current, ...data.summaries].map((summary) => [
            `${summary.periodKind}:${summary.periodStart}`,
            summary,
          ]),
        ).values(),
      ]);
      setLoadedHistoryDays(nextHistoryDays);
      setVisibleDays(nextHistoryDays);
      setHasEarlierHistory(data.hasEarlier);
    } catch (reason) {
      onNotice(
        reason instanceof Error
          ? reason.message
          : 'Could not load earlier work log entries.',
      );
    } finally {
      setLoadingEarlier(false);
    }
  };

  const addEntry = async () => {
    if (!draft.trim() || working) return;
    setWorking(true);
    try {
      const saved = await steer.createWorkLogEntry({
        content: draft,
        sourceKind: draftActivities.length ? 'agent_activity' : 'manual',
        sourceSessionIds: draftActivities.map((item) => item.sessionId),
      });
      setEntries((current) => [saved, ...current]);
      setDraft('');
      setDraftActivities([]);
      if (draftActivities.length && activityRun?.status === 'succeeded') {
        await dismissActivityRun();
      }
      onNotice('Added to today’s work log.');
    } catch (reason) {
      onNotice(
        reason instanceof Error
          ? reason.message
          : 'Could not add work log entry.',
      );
    } finally {
      setWorking(false);
    }
  };

  const collectActivity = async () => {
    if (collecting) return;
    if (activityRun && !['failed', 'cancelled'].includes(activityRun.status))
      return;
    const range = activityRange();
    setCollecting(true);
    try {
      if (activityRun) {
        await steer.dismissWorkLogActivityRun(activityRun.runId);
        setActivityRun(null);
        setActivities([]);
      }
      const result = await steer.workLogActivity(range.from, range.to);
      setActivities(result.activities);
      if (!result.activities.length) {
        onNotice('No Agent conversations found today.');
      } else if (result.runId) {
        setActivityResult('');
        setActivityRun({
          runId: result.runId,
          status: result.status || 'submitted',
          summary: null,
          error: null,
          createdAt: new Date().toISOString(),
        });
        onNotice(
          'Summary started. You can leave this page and come back later.',
        );
      }
    } catch (reason) {
      onNotice(
        reason instanceof Error
          ? reason.message
          : 'Could not summarize Agent activity.',
      );
    } finally {
      setCollecting(false);
    }
  };

  const dismissActivityRun = async () => {
    if (!activityRun) return;
    try {
      await steer.dismissWorkLogActivityRun(activityRun.runId);
    } catch {
      // The local result can still be dismissed if acknowledgement briefly fails.
    }
    setActivityRun(null);
    setActivityResult('');
    setActivities([]);
  };

  const editActivityResult = async () => {
    setDraft((current) =>
      current.trim()
        ? `${current.trim()}\n\n${activityResult}`
        : activityResult,
    );
    setDraftActivities([
      ...new Map(
        [...draftActivities, ...activities].map((item) => [
          item.sessionId,
          item,
        ]),
      ).values(),
    ]);
    onNotice('Summary inserted into your draft. Review it before saving.');
  };

  const addActivityResult = async () => {
    if (!activityResult.trim() || working) return;
    setWorking(true);
    try {
      const saved = await steer.createWorkLogEntry({
        content: activityResult,
        sourceKind: 'agent_activity',
        sourceSessionIds: activities.map((item) => item.sessionId),
      });
      setEntries((current) => [saved, ...current]);
      await dismissActivityRun();
      onNotice('AI summary added to today’s work log.');
    } catch (reason) {
      onNotice(
        reason instanceof Error ? reason.message : 'Could not add summary.',
      );
    } finally {
      setWorking(false);
    }
  };

  const removeEntry = async (entry: WorkLogEntryRecord) => {
    if (working) return;
    setWorking(true);
    try {
      await steer.deleteWorkLogEntry(entry.id);
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      setDeleteTarget(null);
      onNotice('Work log entry deleted.');
    } catch (reason) {
      onNotice(
        reason instanceof Error ? reason.message : 'Could not delete entry.',
      );
    } finally {
      setWorking(false);
    }
  };

  const updateEntry = async (entry: WorkLogEntryRecord) => {
    if (!editingContent.trim() || working) return;
    setWorking(true);
    try {
      const saved = await steer.updateWorkLogEntry(entry.id, editingContent);
      setEntries((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      setEditingID('');
      onNotice('Work log entry updated.');
    } catch (reason) {
      onNotice(
        reason instanceof Error ? reason.message : 'Could not update entry.',
      );
    } finally {
      setWorking(false);
    }
  };

  const saveWeeklySummary = async (
    start: string,
    source: WorkLogEntryRecord[],
  ) => {
    if (!source.length) {
      onNotice('Add a work record before generating a summary.');
      return;
    }
    setWorking(true);
    setWorkingLabel('Starting weekly summary…');
    try {
      const from = new Date(`${start}T00:00:00`);
      const to = new Date(from);
      to.setDate(to.getDate() + 7);
      const run = await steer.generateWeeklySummary(
        start,
        from.toISOString(),
        to.toISOString(),
      );
      setWeeklyRun({
        runId: run.runId,
        status: run.status || 'submitted',
        summary: null,
        error: null,
        createdAt: new Date().toISOString(),
        periodStart: start,
      });
      onNotice('Weekly summary started. You can leave and return later.');
    } catch (reason) {
      onNotice(
        reason instanceof Error ? reason.message : 'Could not save summary.',
      );
    } finally {
      setWorking(false);
      setWorkingLabel('');
    }
  };

  const weekEntries = entries.filter((entry) => {
    const value = dayKey(entry.occurredAt);
    return value >= weekStartKey && value <= dayKey(weekEnd);
  });
  const weekSummary = summaries.find(
    (item) => item.periodKind === 'week' && item.periodStart === weekStartKey,
  );
  const currentWeeklyRun =
    weeklyRun?.periodStart === weekStartKey ? weeklyRun : null;
  const weeklySummaryRunning = Boolean(
    currentWeeklyRun &&
    !['succeeded', 'failed', 'cancelled'].includes(currentWeeklyRun.status),
  );

  if (loading)
    return <div className="ws-work-log-loading">{t('Loading work log…')}</div>;

  if (weekMode)
    return (
      <div className="ws-work-log ws-week-log">
        <header className="ws-work-log-header">
          <div>
            <span className="ws-eyebrow">
              {t('Weekly summaries').toUpperCase()}
            </span>
            <h1>{t('Weekly summaries')}</h1>
            <p>
              {t(
                'Review outcomes first, then trace them back to daily records.',
              )}
            </p>
          </div>
          <Button variant="outline" onClick={() => setWeekMode(false)}>
            <ArrowLeft /> {t('Work log')}
          </Button>
        </header>
        <nav className="ws-week-switcher" aria-label="Week navigation">
          <button
            type="button"
            onClick={() => setWeekOffset((value) => value - 1)}
          >
            <ChevronLeft />
          </button>
          {[-2, -1, 0].map((delta) => {
            const date = startOfWeek(new Date());
            date.setDate(date.getDate() + (weekOffset + delta) * 7);
            const key = dayKey(date);
            return (
              <button
                type="button"
                className={key === weekStartKey ? 'active' : ''}
                key={key}
                onClick={() => setWeekOffset((value) => value + delta)}
              >
                <strong>
                  {t('Week {number}', { number: weekNumber(date) })}
                </strong>
                <span>{formatLogDate(key, language)}</span>
                <small>
                  {summaries.some(
                    (item) =>
                      item.periodKind === 'week' && item.periodStart === key,
                  )
                    ? t('Summary ready')
                    : t('Not summarized')}
                </small>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setWeekOffset((value) => Math.min(0, value + 1))}
            disabled={weekOffset === 0}
          >
            <ChevronRight />
          </button>
        </nav>
        <div className="ws-week-grid">
          <article className="ws-week-summary">
            <header>
              <span className="ws-log-spark">
                <Sparkles />
              </span>
              <div>
                <h2>
                  {t('Week {number} summary', {
                    number: weekNumber(weekStart),
                  })}
                </h2>
                <p>
                  {formatLogDate(weekStartKey, language)} —{' '}
                  {formatLogDate(dayKey(weekEnd), language)} ·{' '}
                  {t('{count} records', { count: weekEntries.length })}
                </p>
              </div>
              <Button
                onClick={() =>
                  void saveWeeklySummary(weekStartKey, weekEntries)
                }
                disabled={working || weeklySummaryRunning}
              >
                <Sparkles />{' '}
                {workingLabel ||
                  (weeklySummaryRunning
                    ? t('Generating…')
                    : currentWeeklyRun &&
                        ['failed', 'cancelled'].includes(
                          currentWeeklyRun.status,
                        )
                      ? t('Retry')
                      : weekSummary
                        ? t('Update')
                        : t('Generate'))}
              </Button>
            </header>
            {currentWeeklyRun &&
              ['failed', 'cancelled'].includes(currentWeeklyRun.status) && (
                <p className="ws-form-error" role="alert">
                  {currentWeeklyRun.error ||
                    'The weekly summary did not finish. Try again.'}
                </p>
              )}
            {weekSummary ? (
              <div className="ws-summary-copy">
                <WorkLogMarkdown>{weekSummary.content}</WorkLogMarkdown>
              </div>
            ) : (
              <div className="ws-summary-empty">
                <Sparkles />
                <strong>{t('No summary yet')}</strong>
                <p>
                  {t(
                    'Generate a concise weekly report from these daily records.',
                  )}
                </p>
              </div>
            )}
          </article>
          <aside className="ws-week-days">
            <h2>{t('Daily records')}</h2>
            {Array.from({ length: 7 }, (_, index) => {
              const date = new Date(weekEnd);
              date.setDate(date.getDate() - index);
              const key = dayKey(date);
              const items = grouped.get(key) || [];
              return (
                <details key={key} open={key === today}>
                  <summary>
                    <span>
                      <strong>{formatLogDate(key, language)}</strong>
                      <small>
                        {t('{count} records', { count: items.length })}
                      </small>
                    </span>
                    <ChevronDown />
                  </summary>
                  {items.length ? (
                    items.map((item) => (
                      <div className="ws-week-day-entry" key={item.id}>
                        <WorkLogMarkdown>{item.content}</WorkLogMarkdown>
                      </div>
                    ))
                  ) : (
                    <p className="empty">{t('No records')}</p>
                  )}
                </details>
              );
            })}
          </aside>
        </div>
      </div>
    );

  return (
    <div className="ws-work-log">
      <header className="ws-work-log-header">
        <div>
          <span className="ws-eyebrow">{t('Workspace').toUpperCase()}</span>
          <h1>{t('Work log')}</h1>
          <p>
            {t(
              'Keep outcomes, decisions, and next steps together with the conversations behind them.',
            )}
          </p>
        </div>
        <Button variant="outline" onClick={() => setWeekMode(true)}>
          <CalendarDays /> {t('Weekly summaries')}
        </Button>
      </header>
      <main className="ws-log-feed">
        <form
          className="ws-log-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void addEntry();
          }}
        >
          <textarea
            ref={draftRef}
            aria-label="Work log draft"
            autoComplete="off"
            disabled={working}
            name="work-log-draft"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (
                !event.nativeEvent.isComposing &&
                (event.metaKey || event.ctrlKey) &&
                event.key === 'Enter'
              ) {
                event.preventDefault();
                void addEntry();
              }
            }}
            placeholder={t(
              'What moved forward? Record an outcome, a decision, or where to pick up next…',
            )}
            rows={3}
          />
          <footer>
            <div>
              <button
                type="button"
                className="ws-ai-action"
                onClick={() => void collectActivity()}
                disabled={
                  collecting ||
                  (!!activityRun &&
                    !['failed', 'cancelled'].includes(activityRun.status))
                }
              >
                <Sparkles />{' '}
                {activityRun?.status === 'succeeded'
                  ? t('Summary ready to review')
                  : collecting
                    ? t('Starting summary…')
                    : activityRun &&
                        !['failed', 'cancelled'].includes(activityRun.status)
                      ? t('Summary in progress')
                      : t('Summarize today’s Agent activity')}
              </button>
              {draftActivities.length > 0 ? (
                <span>
                  Based on {draftActivities.length} active{' '}
                  {draftActivities.length === 1
                    ? 'conversation'
                    : 'conversations'}
                </span>
              ) : (
                <span>{t('⌘ / Ctrl + Enter to add')}</span>
              )}
            </div>
            <Button type="submit" disabled={!draft.trim() || working}>
              {t('Add to log')}
            </Button>
          </footer>
        </form>
        {activityRun && (
          <section className="ws-activity-run" aria-live="polite">
            <header>
              <span className="ws-log-spark">
                {activityRun.status === 'succeeded' ? <Check /> : <Sparkles />}
              </span>
              <div>
                <strong>
                  {activityRun.status === 'succeeded'
                    ? t('Review today’s draft')
                    : activityRun.status === 'failed' ||
                        activityRun.status === 'cancelled'
                      ? t('Could not generate the summary')
                      : t('Summarizing today’s Agent activity')}
                </strong>
                <span>
                  {activityRun.status === 'succeeded'
                    ? `Based on ${activities.length} active ${activities.length === 1 ? 'conversation' : 'conversations'}.`
                    : activityRun.status === 'failed' ||
                        activityRun.status === 'cancelled'
                      ? activityRun.error ||
                        'The System Agent run did not finish.'
                      : t(
                          'Running in the background. You can keep working or return later.',
                        )}
                </span>
              </div>
              {['failed', 'cancelled'].includes(activityRun.status) && (
                <button type="button" onClick={() => void dismissActivityRun()}>
                  <X />
                  <span className="sr-only">Dismiss</span>
                </button>
              )}
            </header>
            {activityRun.status === 'succeeded' && activityResult && (
              <>
                <div className="ws-activity-result">
                  <WorkLogMarkdown>{activityResult}</WorkLogMarkdown>
                </div>
                <footer>
                  <details className="ws-activity-sources">
                    <summary>
                      View {activities.length} sources <ChevronDown />
                    </summary>
                    {activities.map((item) => (
                      <div key={item.sessionId}>
                        <span className="ws-avatar">
                          {item.agentName.slice(0, 1)}
                        </span>
                        <p>
                          <a
                            href={`#chat/${encodeURIComponent(item.sessionId)}`}
                          >
                            <strong>{item.title}</strong>
                          </a>
                          <small>
                            {item.agentName} · {item.messageCount}
                            {item.totalMessageCount > item.messageCount
                              ? ` of ${item.totalMessageCount}`
                              : ''}{' '}
                            messages · {friendlyDate(item.updatedAt)}
                          </small>
                        </p>
                      </div>
                    ))}
                  </details>
                  <div>
                    <Button
                      variant="outline"
                      onClick={() => void dismissActivityRun()}
                    >
                      Dismiss
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void editActivityResult()}
                    >
                      Insert into draft
                    </Button>
                    <Button
                      onClick={() => void addActivityResult()}
                      disabled={working}
                    >
                      Confirm and save
                    </Button>
                  </div>
                </footer>
              </>
            )}
          </section>
        )}
        {!days.length && (
          <p className="ws-log-empty-day">
            No saved records yet. Add a quick update or review today’s Agent
            activity above.
          </p>
        )}
        {days.map((key) => {
          const items = grouped.get(key) || [];
          const open = key === today || openDays.has(key);
          return (
            <section
              className={`ws-log-day ${key === today ? 'today' : ''}`}
              key={key}
            >
              <button
                className="ws-log-day-head"
                type="button"
                aria-expanded={open}
                onClick={() => {
                  if (key === today) return;
                  setOpenDays((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  });
                }}
              >
                <span>
                  <strong>
                    {key === today
                      ? 'Today'
                      : key ===
                          dayKey(
                            new Date(
                              new Date().setDate(new Date().getDate() - 1),
                            ),
                          )
                        ? 'Yesterday'
                        : formatLogDate(key)}
                  </strong>
                  <small>
                    {key === today && `${formatLogDate(key)} · `}
                    {items.length} {items.length === 1 ? 'record' : 'records'}
                  </small>
                </span>
                {key !== today && (
                  <ChevronDown className={open ? 'open' : ''} />
                )}
              </button>
              {open && (
                <div className="ws-log-day-body">
                  {items.length ? (
                    <div className="ws-log-entries">
                      {items.map((item) => (
                        <article
                          key={item.id}
                          className={editingID === item.id ? 'editing' : ''}
                        >
                          <time>
                            {new Date(item.occurredAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </time>
                          <span />
                          {editingID === item.id ? (
                            <div className="ws-log-entry-edit">
                              <textarea
                                aria-label="Edit work log entry"
                                disabled={working}
                                value={editingContent}
                                onChange={(event) =>
                                  setEditingContent(event.target.value)
                                }
                                rows={3}
                              />
                              <footer>
                                <button
                                  type="button"
                                  onClick={() => setEditingID('')}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void updateEntry(item)}
                                  disabled={working || !editingContent.trim()}
                                >
                                  Save
                                </button>
                              </footer>
                            </div>
                          ) : (
                            <div className="ws-log-entry-content">
                              <WorkLogMarkdown>{item.content}</WorkLogMarkdown>
                              {!!item.sourceSessionIds?.length && (
                                <details className="ws-log-source-links">
                                  <summary>
                                    Source conversations ·{' '}
                                    {item.sourceSessionIds.length}
                                  </summary>
                                  {item.sourceSessionIds.map((id) => {
                                    const session = sessions.find(
                                      (candidate) => candidate.id === id,
                                    );
                                    return session ? (
                                      <a
                                        key={id}
                                        href={`#chat/${encodeURIComponent(id)}`}
                                      >
                                        <span>{session.title}</span>
                                        <span>
                                          Continue{' '}
                                          <ChevronRight aria-hidden="true" />
                                        </span>
                                      </a>
                                    ) : (
                                      <span key={id}>
                                        Conversation no longer available
                                      </span>
                                    );
                                  })}
                                </details>
                              )}
                            </div>
                          )}
                          {editingID !== item.id && (
                            <div className="ws-log-entry-actions">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingID(item.id);
                                  setEditingContent(item.content);
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                aria-label="Delete entry"
                                onClick={() => setDeleteTarget(item)}
                              >
                                <Trash2 />
                              </button>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="ws-log-empty-day">
                      No work recorded for this day.
                    </p>
                  )}
                </div>
              )}
            </section>
          );
        })}
        {hasEarlierEntries && (
          <button
            className="ws-load-earlier"
            type="button"
            onClick={() => void loadEarlierEntries()}
            disabled={loadingEarlier}
          >
            {loadingEarlier ? t('Loading earlier entries…') : t('Load earlier')}
          </button>
        )}
      </main>
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !working) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Delete work log entry?</DialogTitle>
          <DialogDescription>
            This removes the saved record. Source conversations remain
            available.
          </DialogDescription>
          <div className="ws-log-delete-actions">
            <Button
              variant="outline"
              disabled={working}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={working}
              onClick={() => {
                if (deleteTarget) void removeEntry(deleteTarget);
              }}
            >
              {working ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
