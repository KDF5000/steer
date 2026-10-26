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
  BarChart3,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Info,
  Import,
  MoreHorizontal,
  MessageCircle,
  Pencil,
  Pin,
  Plus,
  Search,
  Sparkles,
  UserRound,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { runtimeProviderName } from '@/lib/domain';
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
  type FootprintOverviewRecord,
  type FootprintReportRecord,
  type NoteRecord,
  type ProjectRecord,
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
                        {t(runtimeProviderName(agent.runtimeProvider))} ·{' '}
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

type FootprintRange = 'today' | 'week' | 'custom';

const footprintDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const footprintDateRange = (
  range: FootprintRange,
  customFrom: string,
  customTo: string,
) => {
  const today = new Date();
  const from = new Date(today);
  if (range === 'week') from.setDate(from.getDate() - 6);
  const fromKey = range === 'custom' ? customFrom : footprintDateKey(from);
  const toKey = range === 'custom' ? customTo : footprintDateKey(today);
  const start = new Date(`${fromKey}T00:00:00`);
  const end = new Date(`${toKey}T00:00:00`);
  end.setDate(end.getDate() + 1);
  const valid =
    Number.isFinite(start.getTime()) &&
    Number.isFinite(end.getTime()) &&
    end > start &&
    end.getTime() - start.getTime() <= 32 * 86400000;
  return {
    fromKey,
    toKey,
    valid,
    from: valid ? start.toISOString() : '',
    to: valid ? end.toISOString() : '',
  };
};

const compactCount = (value: number) =>
  new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);

export function WorkLogView({
  onNotice,
  sessions,
  projects,
  onOpenSession,
}: {
  onNotice: Notice;
  draftKey: string;
  sessions: ChatSessionRecord[];
  projects: ProjectRecord[];
  onOpenSession: (sessionID: string) => void;
}) {
  const { language, t } = useI18n();
  const today = footprintDateKey(new Date());
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const [range, setRange] = useState<FootprintRange>('week');
  const [customFrom, setCustomFrom] = useState(footprintDateKey(weekStart));
  const [customTo, setCustomTo] = useState(today);
  const [projectID, setProjectID] = useState('');
  const [overview, setOverview] = useState<FootprintOverviewRecord | null>(
    null,
  );
  const [reports, setReports] = useState<FootprintReportRecord[]>([]);
  const [tab, setTab] = useState<'overview' | 'reports'>('overview');
  const [selectedReportID, setSelectedReportID] = useState('');
  const [trendMetric, setTrendMetric] = useState<
    'messages' | 'sessions' | 'tokens'
  >('messages');
  const [selectedDay, setSelectedDay] = useState('');
  const usageDetailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const details = usageDetailsRef.current;
      if (details?.open && !details.contains(event.target as Node))
        details.open = false;
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);

  const [sessionPagination, setSessionPagination] = useState({
    scope: '',
    page: 1,
    size: 10,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadSequence, setReloadSequence] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportPhase, setReportPhase] = useState<
    'setup' | 'generating' | 'edit'
  >('setup');
  const [reportTitle, setReportTitle] = useState('');
  const [reportContent, setReportContent] = useState('');
  const [reportInstructions, setReportInstructions] = useState('');
  const [reportGroup, setReportGroup] = useState<'project' | 'day'>('project');
  const [reportRunID, setReportRunID] = useState('');
  const [reportSources, setReportSources] = useState<string[]>([]);
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [reportProjectID, setReportProjectID] = useState<string | null>(null);
  const [editingReportID, setEditingReportID] = useState('');
  const [savingReport, setSavingReport] = useState(false);
  const [inlineReportDraft, setInlineReportDraft] = useState<{
    id: string;
    title: string;
    content: string;
  } | null>(null);
  const [savingInlineReport, setSavingInlineReport] = useState(false);
  const inlineReportEditor = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const editor = inlineReportEditor.current;
    if (!editor) return;
    const resize = () => {
      editor.style.height = 'auto';
      editor.style.height = `${editor.scrollHeight}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [inlineReportDraft, selectedReportID, tab]);

  useLayoutEffect(() => {
    if (inlineReportDraft?.id === selectedReportID && tab === 'reports')
      inlineReportEditor.current?.focus();
  }, [inlineReportDraft?.id, selectedReportID, tab]);

  const activeRange = footprintDateRange(range, customFrom, customTo);
  const timezone =
    new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  useEffect(() => {
    if (!activeRange.valid) return;
    let cancelled = false;
    void steer
      .footprints(activeRange.from, activeRange.to, timezone, projectID)
      .then((data) => {
        if (!cancelled) {
          setOverview(data);
          setLoadError('');
        }
      })
      .catch((reason) => {
        if (!cancelled)
          setLoadError(
            reason instanceof Error
              ? reason.message
              : 'Could not load footprints.',
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeRange.from,
    activeRange.to,
    activeRange.valid,
    projectID,
    reloadSequence,
    timezone,
  ]);

  useEffect(() => {
    void steer
      .footprintReports()
      .then(setReports)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!reportRunID || reportPhase !== 'generating') return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await steer.run(reportRunID);
        if (cancelled) return;
        if (result.run.status === 'succeeded') {
          if (!result.content.trim())
            throw new Error('The system Agent returned an empty report.');
          setReportContent(result.content.trim());
          setReportPhase('edit');
        } else if (['failed', 'cancelled'].includes(result.run.status)) {
          setReportPhase('setup');
          onNotice(result.error || 'Could not generate the report.');
        }
      } catch (reason) {
        if (!cancelled) {
          setReportPhase('setup');
          onNotice(
            reason instanceof Error
              ? reason.message
              : 'Could not generate the report.',
          );
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [onNotice, reportPhase, reportRunID]);

  const rangeDays = useMemo(() => {
    const items: string[] = [];
    if (!activeRange.valid) return items;
    const cursor = new Date(`${activeRange.fromKey}T12:00:00`);
    const end = new Date(`${activeRange.toKey}T12:00:00`);
    while (cursor <= end) {
      items.push(footprintDateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return items;
  }, [activeRange.fromKey, activeRange.toKey, activeRange.valid]);
  const days = new Map(overview?.days.map((item) => [item.day, item]) || []);
  const maxTrend = rangeDays.reduce((maximum, key) => {
    const item = days.get(key);
    const value =
      trendMetric === 'sessions'
        ? item?.sessions || 0
        : trendMetric === 'tokens'
          ? item?.tokenCount || 0
          : Math.max(item?.userMessages || 0, item?.agentMessages || 0);
    return Math.max(maximum, value);
  }, 1);
  const visibleSessions =
    overview?.sessions.filter(
      (session) => !selectedDay || session.activeDays.includes(selectedDay),
    ) || [];
  const sessionPageScope = `${activeRange.from}:${activeRange.to}:${projectID}:${selectedDay}`;
  const sessionPageCount = Math.max(
    1,
    Math.ceil(visibleSessions.length / sessionPagination.size),
  );
  const sessionPage =
    sessionPagination.scope === sessionPageScope
      ? Math.min(sessionPagination.page, sessionPageCount)
      : 1;
  const sessionPageStart = (sessionPage - 1) * sessionPagination.size;
  const pagedSessions = visibleSessions.slice(
    sessionPageStart,
    sessionPageStart + sessionPagination.size,
  );
  const resetSessionPage = () =>
    setSessionPagination((current) => ({ ...current, page: 1, scope: '' }));
  const changeSessionPage = (page: number) =>
    setSessionPagination((current) => ({
      ...current,
      scope: sessionPageScope,
      page,
    }));
  const selectedReport = reports.find(
    (report) => report.id === selectedReportID,
  );
  const editingInline = inlineReportDraft?.id === selectedReportID;

  const openReport = () => {
    if (reportRunID && ['generating', 'edit'].includes(reportPhase)) {
      setReportOpen(true);
      return;
    }
    const selectedFrom = selectedDay
      ? new Date(`${selectedDay}T00:00:00`).toISOString()
      : activeRange.from;
    const selectedEnd = selectedDay
      ? new Date(`${selectedDay}T00:00:00`)
      : new Date(activeRange.to);
    if (selectedDay) selectedEnd.setDate(selectedEnd.getDate() + 1);
    const selectedTo = selectedEnd.toISOString();
    const label = selectedDay
      ? selectedDay.slice(5).replace('-', '.')
      : `${activeRange.fromKey.slice(5).replace('-', '.')} — ${activeRange.toKey.slice(5).replace('-', '.')}`;
    setEditingReportID('');
    setReportTitle(
      `${label} ${language === 'zh-CN' ? '工作回顾' : 'Work review'}`,
    );
    setReportContent('');
    setReportInstructions('');
    setReportGroup('project');
    setReportRunID('');
    setReportSources([]);
    setReportFrom(selectedFrom);
    setReportTo(selectedTo);
    setReportProjectID(projectID || null);
    setReportPhase('setup');
    setReportOpen(true);
  };

  const generateReport = async () => {
    try {
      setReportPhase('generating');
      const result = await steer.generateFootprintReport({
        from: reportFrom,
        to: reportTo,
        projectId: reportProjectID || undefined,
        groupBy: reportGroup,
        instructions: reportInstructions.trim() || undefined,
      });
      setReportRunID(result.runId);
      setReportSources(result.sourceSessionIds);
    } catch (reason) {
      setReportPhase('setup');
      onNotice(
        reason instanceof Error
          ? reason.message
          : 'Could not generate the report.',
      );
    }
  };

  const saveReport = async () => {
    if (!reportTitle.trim() || !reportContent.trim() || savingReport) return;
    setSavingReport(true);
    try {
      const saved = await steer.saveFootprintReport({
        id: editingReportID || undefined,
        title: reportTitle,
        content: reportContent,
        from: reportFrom,
        to: reportTo,
        projectId: reportProjectID,
        sourceSessionIds: reportSources,
        runId: reportRunID || undefined,
      });
      setReports((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ]);
      setEditingReportID(saved.id);
      setReportRunID('');
      setSelectedReportID(saved.id);
      setTab('reports');
      setReportOpen(false);
      onNotice(t('Report saved.'));
    } catch (reason) {
      onNotice(
        reason instanceof Error ? reason.message : 'Could not save the report.',
      );
    } finally {
      setSavingReport(false);
    }
  };

  const openSavedReport = (report: FootprintReportRecord) => {
    setSelectedReportID(report.id);
  };

  const editSavedReport = (report: FootprintReportRecord) => {
    setInlineReportDraft({
      id: report.id,
      title: report.title,
      content: report.content,
    });
  };

  const saveInlineReport = async () => {
    if (
      !selectedReport ||
      !inlineReportDraft ||
      savingInlineReport ||
      !inlineReportDraft.title.trim() ||
      !inlineReportDraft.content.trim()
    )
      return;
    setSavingInlineReport(true);
    try {
      const saved = await steer.saveFootprintReport({
        id: selectedReport.id,
        title: inlineReportDraft.title,
        content: inlineReportDraft.content,
        from: selectedReport.from,
        to: selectedReport.to,
        projectId: selectedReport.projectId,
        sourceSessionIds: selectedReport.sourceSessionIds,
      });
      setReports((current) =>
        current.map((report) => (report.id === saved.id ? saved : report)),
      );
      setInlineReportDraft(null);
      onNotice(t('Report saved.'));
    } catch (reason) {
      onNotice(
        reason instanceof Error ? reason.message : 'Could not save the report.',
      );
    } finally {
      setSavingInlineReport(false);
    }
  };

  const downloadReport = (report?: FootprintReportRecord) => {
    const title = report?.title || reportTitle;
    const content = report?.content || reportContent;
    const blob = new Blob([`# ${title}\n\n${content}`], {
      type: 'text/markdown',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${title || 'Steer report'}.md`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const reportFromKey = reportFrom
    ? footprintDateKey(new Date(reportFrom))
    : activeRange.fromKey;
  const reportToKey = reportTo
    ? footprintDateKey(new Date(new Date(reportTo).getTime() - 1))
    : activeRange.toKey;
  const reportConversationCount =
    reportPhase === 'edit'
      ? reportSources.length
      : selectedDay
        ? visibleSessions.length
        : overview?.totals.activeSessions || 0;

  return (
    <div className="ws-work-log ws-footprints">
      <header className="ws-work-log-header">
        <div>
          <h1>{t('Footprints')}</h1>
          <p>
            {t(
              'Review the work that happened in Steer and keep every step traceable.',
            )}
          </p>
        </div>
        <Button
          onClick={openReport}
          disabled={
            savingInlineReport ||
            !activeRange.valid ||
            !overview?.totals.activeSessions
          }
        >
          <Sparkles />{' '}
          {reportRunID
            ? reportPhase === 'generating'
              ? t('Generating…')
              : t('Report ready')
            : t('Generate report')}
        </Button>
      </header>
      <nav className="ws-footprint-tabs" aria-label={t('Footprints')}>
        <button
          className={tab === 'overview' ? 'active' : ''}
          disabled={savingInlineReport}
          onClick={() => setTab('overview')}
        >
          {t('Overview')}
        </button>
        <button
          className={tab === 'reports' ? 'active' : ''}
          disabled={savingInlineReport}
          onClick={() => setTab('reports')}
        >
          {t('Reports')} <span>{reports.length}</span>
        </button>
      </nav>
      {tab === 'reports' ? (
        selectedReport ? (
          <article className="ws-footprint-report-detail">
            <div className="ws-footprint-report-toolbar">
              <Button
                variant="ghost"
                size="sm"
                className="ws-footprint-report-back"
                disabled={savingInlineReport}
                onClick={() => setSelectedReportID('')}
              >
                <ArrowLeft />
                {t('Back to reports')}
              </Button>
              <div className="ws-footprint-report-detail-actions">
                {editingInline ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={savingInlineReport}
                      onClick={() => setInlineReportDraft(null)}
                    >
                      {t('Cancel')}
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        savingInlineReport ||
                        !inlineReportDraft?.title.trim() ||
                        !inlineReportDraft?.content.trim()
                      }
                      onClick={() => void saveInlineReport()}
                    >
                      {savingInlineReport ? t('Saving…') : t('Save report')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => downloadReport(selectedReport)}
                    >
                      <Download />
                      {t('Export Markdown')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => editSavedReport(selectedReport)}
                    >
                      <Pencil />
                      {t('Edit report')}
                    </Button>
                  </>
                )}
              </div>
            </div>
            <header>
              {editingInline && inlineReportDraft ? (
                <input
                  className="ws-footprint-report-title-editor"
                  aria-label={t('Report title')}
                  maxLength={160}
                  value={inlineReportDraft.title}
                  disabled={savingInlineReport}
                  onChange={(event) =>
                    setInlineReportDraft((current) =>
                      current
                        ? { ...current, title: event.target.value }
                        : current,
                    )
                  }
                />
              ) : (
                <h2>{selectedReport.title}</h2>
              )}
              <p>
                {new Date(selectedReport.from).toLocaleDateString(language)} —{' '}
                {new Date(
                  new Date(selectedReport.to).getTime() - 1,
                ).toLocaleDateString(language)}{' '}
                ·{' '}
                {t('{count} source conversations', {
                  count: selectedReport.sourceSessionIds.length,
                })}
              </p>
            </header>
            <div className="ws-footprint-report-document">
              {editingInline && inlineReportDraft ? (
                <textarea
                  ref={inlineReportEditor}
                  className="ws-footprint-report-inline-editor"
                  aria-label={t('Report content')}
                  value={inlineReportDraft.content}
                  disabled={savingInlineReport}
                  onChange={(event) =>
                    setInlineReportDraft((current) =>
                      current
                        ? { ...current, content: event.target.value }
                        : current,
                    )
                  }
                />
              ) : (
                <WorkLogMarkdown>{selectedReport.content}</WorkLogMarkdown>
              )}
            </div>
            <details className="ws-footprint-report-sources">
              <summary>
                {t('{count} source conversations', {
                  count: selectedReport.sourceSessionIds.length,
                })}
              </summary>
              {selectedReport.sourceSessionIds.map((sessionID) => (
                <button
                  key={sessionID}
                  disabled={savingInlineReport}
                  onClick={() => onOpenSession(sessionID)}
                >
                  {sessions.find((item) => item.id === sessionID)?.title ||
                    sessionID}
                  <ExternalLink />
                </button>
              ))}
            </details>
          </article>
        ) : (
          <section className="ws-footprint-reports">
            <header>
              <h2>{t('Saved reports')}</h2>
            </header>
            {reports.length ? (
              reports.map((report) => (
                <button key={report.id} onClick={() => openSavedReport(report)}>
                  <span>
                    <strong>{report.title}</strong>
                    <small>
                      {new Date(report.from).toLocaleDateString(language)} —{' '}
                      {new Date(
                        new Date(report.to).getTime() - 1,
                      ).toLocaleDateString(language)}{' '}
                      ·{' '}
                      {t('{count} source conversations', {
                        count: report.sourceSessionIds.length,
                      })}
                    </small>
                  </span>
                  <ChevronRight />
                </button>
              ))
            ) : (
              <div className="ws-footprint-empty">
                <FileText />
                <strong>{t('No reports yet')}</strong>
                <p>
                  {t('Choose a range and generate your first work report.')}
                </p>
              </div>
            )}
          </section>
        )
      ) : (
        <>
          <div className="ws-footprint-filters">
            <div className="ws-footprint-range">
              {(['today', 'week', 'custom'] as FootprintRange[]).map((item) => (
                <button
                  key={item}
                  className={range === item ? 'active' : ''}
                  onClick={() => {
                    setRange(item);
                    setSelectedDay('');
                    resetSessionPage();
                  }}
                >
                  {item === 'today'
                    ? t('Today')
                    : item === 'week'
                      ? t('Last 7 days')
                      : t('Custom')}
                </button>
              ))}
            </div>
            {range === 'custom' ? (
              <div className="ws-footprint-dates">
                <input
                  aria-label={t('Start date')}
                  type="date"
                  value={customFrom}
                  max={customTo}
                  onChange={(event) => {
                    setCustomFrom(event.target.value);
                    setSelectedDay('');
                    resetSessionPage();
                  }}
                />
                <span>—</span>
                <input
                  aria-label={t('End date')}
                  type="date"
                  value={customTo}
                  min={customFrom}
                  onChange={(event) => {
                    setCustomTo(event.target.value);
                    setSelectedDay('');
                    resetSessionPage();
                  }}
                />
              </div>
            ) : (
              <span className="ws-footprint-date-label">
                {activeRange.fromKey.replaceAll('-', '.')} —{' '}
                {activeRange.toKey.replaceAll('-', '.')}
              </span>
            )}
            <select
              aria-label={t('Filter by project')}
              value={projectID}
              onChange={(event) => {
                setProjectID(event.target.value);
                setSelectedDay('');
                resetSessionPage();
              }}
            >
              <option value="">{t('All projects')}</option>
              {projects.map((project) => (
                <option value={project.id} key={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          {loading && activeRange.valid ? (
            <div className="ws-footprint-state">{t('Loading footprints…')}</div>
          ) : !activeRange.valid || loadError ? (
            <div className="ws-footprint-state error" role="alert">
              {!activeRange.valid
                ? t('Choose a valid date range of up to 32 days.')
                : loadError}
              <Button
                variant="outline"
                onClick={() => setReloadSequence((value) => value + 1)}
              >
                {t('Try again')}
              </Button>
            </div>
          ) : (
            overview && (
              <>
                <section className="ws-footprint-metrics">
                  <article>
                    <header>
                      {t('Active conversations')}
                      <MessageCircle />
                    </header>
                    <strong>{overview.totals.activeSessions}</strong>
                    <p>
                      {t('{count} started in this range', {
                        count: overview.totals.newSessions,
                      })}
                    </p>
                  </article>
                  <article>
                    <header>
                      {t('Your messages')}
                      <UserRound />
                    </header>
                    <strong>
                      {compactCount(overview.totals.userMessages)}
                    </strong>
                    <p>{t('Messages sent by you')}</p>
                  </article>
                  <article>
                    <header>
                      {t('Agent replies')}
                      <Bot />
                    </header>
                    <strong>
                      {compactCount(overview.totals.agentMessages)}
                    </strong>
                    <p>{t('Tool calls and stream chunks excluded')}</p>
                  </article>
                  <article>
                    <header>
                      {t('Known token usage')}
                      <BarChart3 />
                    </header>
                    <strong>
                      {overview.totals.tokenCount == null
                        ? '—'
                        : compactCount(overview.totals.tokenCount)}
                    </strong>
                    {overview.totals.tokenCount != null ? (
                      <p
                        title={t(
                          'Cache tokens are included in input; reasoning is included in output.',
                        )}
                      >
                        {t('Input')}{' '}
                        {overview.totals.inputTokens == null
                          ? '—'
                          : compactCount(overview.totals.inputTokens)}{' '}
                        · {t('Output')}{' '}
                        {overview.totals.outputTokens == null
                          ? '—'
                          : compactCount(overview.totals.outputTokens)}
                      </p>
                    ) : (
                      <p className="warning">
                        {t('Token usage is not available yet')}
                      </p>
                    )}
                    <div className="ws-footprint-usage-footer">
                      <span
                        title={`${t('Usage coverage')}: ${overview.totals.tokenCoverage || 0} / ${overview.totals.totalRuns || 0} ${t('runs')}`}
                      >
                        {t('Coverage')} {overview.totals.tokenCoverage || 0} /{' '}
                        {overview.totals.totalRuns || 0}
                      </span>
                      {overview.totals.tokenCount != null && (
                        <details
                          className="ws-footprint-usage-details"
                          ref={usageDetailsRef}
                        >
                          <summary
                            onKeyDown={(event) => {
                              if (
                                event.key === 'Escape' &&
                                usageDetailsRef.current
                              )
                                usageDetailsRef.current.open = false;
                            }}
                            onBlur={() => {
                              if (usageDetailsRef.current)
                                usageDetailsRef.current.open = false;
                            }}
                          >
                            {t('Usage details')}
                            <ChevronDown />
                          </summary>
                          <div className="ws-footprint-usage-popover">
                            <dl>
                              <div>
                                <dt>{t('Cache read')}</dt>
                                <dd>
                                  {overview.totals.cacheReadTokens == null
                                    ? '—'
                                    : compactCount(
                                        overview.totals.cacheReadTokens,
                                      )}
                                </dd>
                              </div>
                              <div>
                                <dt>{t('Cache write')}</dt>
                                <dd>
                                  {overview.totals.cacheWriteTokens == null
                                    ? '—'
                                    : compactCount(
                                        overview.totals.cacheWriteTokens,
                                      )}
                                </dd>
                              </div>
                            </dl>
                            <p>
                              {t('Cache usage is included in input tokens.')}
                            </p>
                            <p>
                              {t('Usage coverage')}:{' '}
                              {overview.totals.tokenCoverage || 0} /{' '}
                              {overview.totals.totalRuns || 0} {t('runs')}
                            </p>
                            {!!overview.totals.partialRuns && (
                              <p>
                                {t('{count} partially reported', {
                                  count: overview.totals.partialRuns,
                                })}
                              </p>
                            )}
                          </div>
                        </details>
                      )}
                    </div>
                  </article>
                </section>
                <section className="ws-footprint-trend">
                  <header>
                    <div>
                      <h2>{t('Activity trend')}</h2>
                      <p>{t('See when work happened')}</p>
                    </div>
                    <select
                      value={trendMetric}
                      onChange={(event) =>
                        setTrendMetric(
                          event.target.value as
                            | 'messages'
                            | 'sessions'
                            | 'tokens',
                        )
                      }
                    >
                      <option value="messages">{t('Messages')}</option>
                      <option value="sessions">{t('Conversations')}</option>
                      <option value="tokens">{t('Known token usage')}</option>
                    </select>
                  </header>
                  <div className="ws-footprint-legend">
                    {trendMetric === 'messages' ? (
                      <>
                        <span>
                          <i />
                          {t('Your messages')}
                        </span>
                        <span>
                          <i className="agent" />
                          {t('Agent replies')}
                        </span>
                      </>
                    ) : (
                      <span>
                        <i />
                        {trendMetric === 'tokens'
                          ? t('Known token usage')
                          : t('Active conversations')}
                      </span>
                    )}
                  </div>
                  <div className="ws-footprint-chart">
                    {rangeDays.map((key) => {
                      const item = days.get(key);
                      const first =
                        trendMetric === 'sessions'
                          ? item?.sessions || 0
                          : trendMetric === 'tokens'
                            ? item?.tokenCount || 0
                            : item?.userMessages || 0;
                      const second =
                        trendMetric === 'messages'
                          ? item?.agentMessages || 0
                          : 0;
                      return (
                        <button
                          key={key}
                          className={selectedDay === key ? 'active' : ''}
                          onClick={() => {
                            setSelectedDay((value) =>
                              value === key ? '' : key,
                            );
                            resetSessionPage();
                          }}
                          title={`${key}: ${trendMetric === 'tokens' && item?.tokenCount == null ? t('Not reported') : first}${trendMetric === 'messages' ? ` / ${second}` : ''}`}
                        >
                          <span className="bars">
                            <i
                              style={{
                                height: `${Math.max(first ? 3 : 0, (first / maxTrend) * 110)}px`,
                              }}
                            />
                            {trendMetric === 'messages' && (
                              <i
                                className="agent"
                                style={{
                                  height: `${Math.max(second ? 3 : 0, (second / maxTrend) * 110)}px`,
                                }}
                              />
                            )}
                          </span>
                          <small>{key.slice(5).replace('-', '/')}</small>
                        </button>
                      );
                    })}
                  </div>
                  <footer>
                    <span>
                      {trendMetric === 'tokens'
                        ? t(
                            'Token usage is assigned to the run completion date.',
                          )
                        : t('Select a date to filter conversations.')}
                    </span>
                    <span>
                      {t('Statistics timezone')}: {overview.timezone}
                    </span>
                  </footer>
                </section>
                <section className="ws-footprint-sessions">
                  <header>
                    <div>
                      <h2>{t('Conversation details')}</h2>
                      <span>
                        {t('{count} conversations', {
                          count: visibleSessions.length,
                        })}
                      </span>
                      {selectedDay && (
                        <button
                          onClick={() => {
                            setSelectedDay('');
                            resetSessionPage();
                          }}
                        >
                          {selectedDay.slice(5).replace('-', '/')} ×
                        </button>
                      )}
                    </div>
                    <span>{t('Sorted by recent activity')}</span>
                  </header>
                  {visibleSessions.length ? (
                    <div className="ws-footprint-table">
                      <table>
                        <thead>
                          <tr>
                            <th>{t('Conversation / Project')}</th>
                            <th>{t('Your messages')}</th>
                            <th>{t('Agent replies')}</th>
                            <th>{t('Token')}</th>
                            <th>{t('Recent activity')}</th>
                            <th aria-label={t('Open conversation')} />
                          </tr>
                        </thead>
                        <tbody>
                          {pagedSessions.map((session) => (
                            <tr
                              key={session.sessionId}
                              onClick={() => onOpenSession(session.sessionId)}
                            >
                              <td>
                                <button>{session.title}</button>
                                <small>
                                  {session.projectName || t('No project')} ·{' '}
                                  {session.agentName}
                                  {new Date(session.createdAt) >=
                                    new Date(activeRange.from) &&
                                  new Date(session.createdAt) <
                                    new Date(activeRange.to)
                                    ? ` · ${t('New conversation')}`
                                    : ''}
                                </small>
                              </td>
                              <td>{session.userMessages}</td>
                              <td>{session.agentMessages}</td>
                              <td>
                                <span
                                  title={
                                    session.tokenCount == null
                                      ? t('Token usage is not available yet')
                                      : `${t('Usage coverage')}: ${session.tokenCoverage || 0} / ${session.totalRuns || 0} ${t('runs')}`
                                  }
                                >
                                  {session.tokenCount == null
                                    ? t('Not reported')
                                    : compactCount(session.tokenCount)}
                                  {!!session.partialRuns && (
                                    <small>{t('Partially reported')}</small>
                                  )}
                                </span>
                              </td>
                              <td>
                                {new Date(session.lastActiveAt).toLocaleString(
                                  language,
                                  {
                                    month: 'numeric',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  },
                                )}
                              </td>
                              <td>
                                <ChevronRight />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="ws-footprint-empty">
                      <MessageCircle />
                      <strong>{t('No activity in this range')}</strong>
                      <p>{t('Try another date or project.')}</p>
                    </div>
                  )}
                  {visibleSessions.length > 10 && (
                    <div className="ws-footprint-pagination">
                      <span aria-live="polite">
                        {t('Showing {from}–{to} of {total} conversations', {
                          from: sessionPageStart + 1,
                          to: Math.min(
                            sessionPageStart + sessionPagination.size,
                            visibleSessions.length,
                          ),
                          total: visibleSessions.length,
                        })}
                      </span>
                      <div className="ws-footprint-pagination-controls">
                        <label>
                          <span>{t('Rows per page')}</span>
                          <select
                            aria-label={t('Rows per page')}
                            value={sessionPagination.size}
                            onChange={(event) =>
                              setSessionPagination({
                                scope: sessionPageScope,
                                page: 1,
                                size: Number(event.target.value),
                              })
                            }
                          >
                            {[10, 20, 50].map((size) => (
                              <option key={size} value={size}>
                                {size}
                              </option>
                            ))}
                          </select>
                        </label>
                        <nav aria-label={t('Conversation pagination')}>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('Previous page')}
                            disabled={sessionPage <= 1}
                            onClick={() => changeSessionPage(sessionPage - 1)}
                          >
                            <ChevronLeft />
                          </Button>
                          <span aria-live="polite">
                            {t('Page {page} of {pages}', {
                              page: sessionPage,
                              pages: sessionPageCount,
                            })}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('Next page')}
                            disabled={sessionPage >= sessionPageCount}
                            onClick={() => changeSessionPage(sessionPage + 1)}
                          >
                            <ChevronRight />
                          </Button>
                        </nav>
                      </div>
                    </div>
                  )}
                  <footer>
                    <span>
                      {t('Message counts only include the selected range.')}
                    </span>
                    <span>
                      {t('Usage coverage')}:{' '}
                      {overview.totals.tokenCoverage || 0} /{' '}
                      {overview.totals.totalRuns || 0} {t('runs')}
                    </span>
                  </footer>
                </section>
                <p className="ws-footprint-scope">
                  <Info />
                  {t(
                    'Footprints only include activity inside Steer. Message and token counts do not measure work outcomes.',
                  )}
                </p>
              </>
            )
          )}
        </>
      )}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="ws-footprint-report-dialog" showCloseButton>
          <div className="ws-footprint-report-head">
            <DialogTitle>
              {reportPhase === 'edit'
                ? t('Report draft')
                : t('Generate report')}
            </DialogTitle>
            <DialogDescription>
              {reportFromKey} — {reportToKey} ·{' '}
              {t('{count} conversations', {
                count: reportConversationCount,
              })}
            </DialogDescription>
          </div>
          {reportPhase === 'setup' ? (
            <div className="ws-footprint-report-body">
              <div className="ws-footprint-report-scope">
                <strong>
                  {reportFromKey} — {reportToKey}
                </strong>
                <small>
                  {reportProjectID
                    ? projects.find((item) => item.id === reportProjectID)?.name
                    : t('All projects')}{' '}
                  ·{' '}
                  {t('{count} conversations', {
                    count: reportConversationCount,
                  })}
                </small>
                <small>
                  {t('Only messages inside this range will be summarized.')}
                </small>
              </div>
              <label>
                <span>{t('Report title')}</span>
                <input
                  value={reportTitle}
                  onChange={(event) => setReportTitle(event.target.value)}
                />
              </label>
              <label>
                <span>{t('Organization')}</span>
                <select
                  value={reportGroup}
                  onChange={(event) =>
                    setReportGroup(event.target.value as 'project' | 'day')
                  }
                >
                  <option value="project">{t('Group by project')}</option>
                  <option value="day">{t('Group by day')}</option>
                </select>
              </label>
              <label>
                <span>
                  {t('Additional instructions')} <small>{t('Optional')}</small>
                </span>
                <textarea
                  value={reportInstructions}
                  onChange={(event) =>
                    setReportInstructions(event.target.value)
                  }
                  placeholder={t(
                    'For example: focus on product decisions and list follow-ups separately.',
                  )}
                />
              </label>
              <p>
                {t(
                  'The report includes source conversations. Verify completion claims before sharing it.',
                )}
              </p>
              <Button
                onClick={() => void generateReport()}
                disabled={!reportTitle.trim()}
              >
                <Sparkles />
                {t('Generate report')}
              </Button>
            </div>
          ) : reportPhase === 'generating' ? (
            <div className="ws-footprint-report-progress">
              <Sparkles />
              <strong>{t('Generating report…')}</strong>
              <p>
                {t(
                  'You can keep working while the system Agent reviews the selected conversations.',
                )}
              </p>
            </div>
          ) : (
            <div className="ws-footprint-report-body">
              <label>
                <span>{t('Report title')}</span>
                <input
                  value={reportTitle}
                  onChange={(event) => setReportTitle(event.target.value)}
                />
              </label>
              <label>
                <span>{t('Report content')}</span>
                <textarea
                  className="editor"
                  value={reportContent}
                  onChange={(event) => setReportContent(event.target.value)}
                />
              </label>
              <details>
                <summary>
                  {t('{count} source conversations', {
                    count: reportSources.length,
                  })}
                </summary>
                {reportSources.map((sessionID) => (
                  <button
                    key={sessionID}
                    onClick={() => {
                      setReportOpen(false);
                      onOpenSession(sessionID);
                    }}
                  >
                    {sessions.find((item) => item.id === sessionID)?.title ||
                      sessionID}
                    <ExternalLink />
                  </button>
                ))}
              </details>
              <div className="ws-footprint-report-actions">
                <Button variant="outline" onClick={() => downloadReport()}>
                  <Download />
                  {t('Export Markdown')}
                </Button>
                <Button
                  onClick={() => void saveReport()}
                  disabled={
                    savingReport || !reportTitle.trim() || !reportContent.trim()
                  }
                >
                  {savingReport ? t('Saving…') : t('Save report')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function LegacyWorkLogView({
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
