'use client';

/* oxlint-disable jsx-a11y/prefer-tag-over-role -- inline rich input and custom keyboard autocomplete require ARIA roles */
/* oxlint-disable typescript/no-deprecated -- keyCode 229 is needed for Safari IME confirmation */
import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useI18n } from '@/lib/i18n';
import { X } from 'lucide-react';
import type { AgentProfile as AgentItem, ChatMessage } from '@/lib/domain';

// Keep ordinary keystrokes below the conversation tree. A revision identifies
// explicit draft replacement (new chat, handoff, submit, or failed submission),
// so unrelated message updates cannot overwrite the user's in-progress text.
export function ComposerDraft({
  input,
  revision,
  readInput,
  onInput,
  children,
}: {
  input: string;
  revision: number;
  readInput: () => string;
  onInput: (text: string) => void;
  children: (text: string, onChange: (text: string) => void) => ReactNode;
}) {
  const [draft, setDraft] = useState(() => ({ text: readInput(), revision }));
  if (draft.revision !== revision) setDraft({ text: input, revision });
  return children(draft.text, (text) => {
    setDraft({ text, revision });
    onInput(text);
  });
}

export function quotationSummary(text: string, limit = 56) {
  const plain = text
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > limit ? plain.slice(0, limit) + '…' : plain;
}

export function focusInlineComposer(editor: HTMLSpanElement | null) {
  if (!editor) return;
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  const end = editor.lastChild;
  if (end instanceof HTMLBRElement && end.dataset.composerBreak)
    range.setEndBefore(end);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function InlineComposer({
  input,
  onInput,
  reference,
  target,
  agents,
  disabled,
  onReferenceRemove,
  onTarget,
  onSend,
  onImages,
  editorRef,
  placeholder,
}: {
  input: string;
  onInput: (text: string) => void;
  reference?: ChatMessage;
  target?: AgentItem;
  agents: AgentItem[];
  disabled: boolean;
  onReferenceRemove: () => void;
  onTarget: (agent?: AgentItem) => void;
  onSend: () => void;
  onImages: (files: File[]) => void;
  editorRef: RefObject<HTMLSpanElement | null>;
  placeholder: string;
}) {
  const { t } = useI18n();
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const composing = useRef(false);
  const query = !target ? input.match(/(?:^|\s)@([^\s@]*)$/) : null;
  const choices = query
    ? agents.filter((agent) =>
        agent.name.toLowerCase().includes(query[1].toLowerCase()),
      )
    : [];
  const open = Boolean(query && !dismissed && !disabled);
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || composing.current) return;
    const replacing =
      editor.textContent !== input || (!input && editor.childNodes.length > 0);
    const focused = document.activeElement === editor;
    if (replacing) editor.textContent = input;
    // A trailing newline needs an editing break so Chrome places the next
    // character on the new line. The break contributes no text to the prompt.
    const end = editor.lastChild;
    if (input.endsWith('\n')) {
      if (!(end instanceof HTMLBRElement)) {
        const lineBreak = document.createElement('br');
        lineBreak.dataset.composerBreak = 'true';
        editor.appendChild(lineBreak);
      }
    } else if (end instanceof HTMLBRElement && end.dataset.composerBreak) {
      end.remove();
    }
    if (replacing && focused) focusInlineComposer(editor);
  }, [input, editorRef]);
  const focus = () => focusInlineComposer(editorRef.current);
  useLayoutEffect(() => {
    focusInlineComposer(editorRef.current);
  }, [reference?.id, target?.id, editorRef]);
  const selectedAll = useRef(false);
  const atStart = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (
      !editor ||
      !selection?.isCollapsed ||
      !selection.anchorNode ||
      !editor.contains(selection.anchorNode)
    )
      return false;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    return range.toString().length === 0;
  };
  const removePreviousToken = () => {
    if (target) {
      onTarget(undefined);
      return true;
    }
    if (reference) {
      onReferenceRemove();
      return true;
    }
    return false;
  };
  const select = (agent: AgentItem) => {
    onInput(input.replace(/@[^\s@]*$/, ''));
    onTarget(agent);
    setDismissed(false);
    requestAnimationFrame(focus);
  };
  const insert = (text: string) => {
    const selection = window.getSelection();
    if (
      !selection?.rangeCount ||
      !editorRef.current?.contains(selection.anchorNode)
    )
      return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStart(node, node.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    onInput(editorRef.current.textContent || '');
  };
  return (
    <div
      className="ws-inline-composer"
      onPointerDown={(event) => {
        if (
          event.target === event.currentTarget ||
          (event.target instanceof HTMLElement &&
            event.target.classList.contains('ws-inline-line'))
        ) {
          event.preventDefault();
          focus();
        }
      }}
    >
      {reference && (
        <span
          className="ws-inline-token ws-quote-token"
          contentEditable={false}
        >
          <button
            type="button"
            className="ws-quote-remove"
            disabled={disabled}
            aria-label={t('Remove quotation')}
            title={t('Remove quotation')}
            onClick={onReferenceRemove}
          >
            <X aria-hidden="true" />
          </button>
          <span className="ws-quote-divider" aria-hidden="true">
            |
          </span>
          <details>
            <summary
              title={t('View quotation')}
              onKeyDown={(event) => {
                if (
                  !disabled &&
                  (event.key === 'Backspace' || event.key === 'Delete')
                ) {
                  event.preventDefault();
                  onReferenceRemove();
                }
              }}
            >
              <span className="ws-quote-label">{t('Quote')}</span>
              <span>{quotationSummary(reference.text, 180)}</span>
            </summary>
            <div className="ws-quote-preview">{reference.text}</div>
          </details>
        </span>
      )}
      <div className="ws-inline-line">
        {target && (
          <span
            className="ws-inline-token ws-mention-token"
            contentEditable={false}
          >
            <button
              type="button"
              disabled={disabled}
              aria-label={`${target.name} · ${t('Press Backspace to remove')}`}
              onClick={focus}
              onKeyDown={(event) => {
                if (event.key === 'Backspace' || event.key === 'Delete') {
                  event.preventDefault();
                  onTarget(undefined);
                }
              }}
            >
              <span>@{target.name}</span>
            </button>
          </span>
        )}
        <span
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          aria-label="Message Agent"
          aria-multiline="true"
          aria-controls={open ? 'steer-agent-mentions' : undefined}
          aria-activedescendant={
            open && choices[active]
              ? `steer-agent-mention-${choices[active].id}`
              : undefined
          }
          data-onboarding="chat"
          data-placeholder={placeholder}
          className="ws-inline-editor"
          onInput={(event) => {
            onInput(event.currentTarget.textContent || '');
            setActive(0);
            setDismissed(false);
          }}
          onBeforeInput={(event) => {
            if (
              !disabled &&
              !composing.current &&
              (event.nativeEvent as InputEvent).inputType ===
                'deleteContentBackward' &&
              atStart() &&
              (target || reference)
            ) {
              event.preventDefault();
              removePreviousToken();
            }
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onPaste={(event) => {
            event.preventDefault();
            const files = Array.from(event.clipboardData.items)
              .filter(
                (item) =>
                  item.kind === 'file' && item.type.startsWith('image/'),
              )
              .map((item) => item.getAsFile())
              .filter((file): file is File => file !== null);
            if (files.length) onImages(files);
            else {
              const text = event.clipboardData
                .getData('text/plain')
                .replace(/\r\n?/g, '\n')
                .replace(/(?:\n[^\S\n]*)+$/, '');
              if (text) insert(text);
            }
          }}
          onKeyDown={(event) => {
            // Safari can report isComposing=false on the IME confirmation Enter.
            if (
              composing.current ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            )
              return;
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key.toLowerCase() === 'a'
            )
              selectedAll.current = true;
            else if (
              selectedAll.current &&
              (event.key === 'Backspace' || event.key === 'Delete')
            ) {
              event.preventDefault();
              selectedAll.current = false;
              onInput('');
              onTarget(undefined);
              onReferenceRemove();
              if (editorRef.current) editorRef.current.textContent = '';
              focus();
              return;
            } else if (event.key !== 'Control' && event.key !== 'Meta')
              selectedAll.current = false;
            if (
              event.key === 'Backspace' &&
              atStart() &&
              removePreviousToken()
            ) {
              event.preventDefault();
              return;
            }
            if (
              open &&
              (event.key === 'ArrowDown' || event.key === 'ArrowUp')
            ) {
              event.preventDefault();
              setActive((current) =>
                Math.max(
                  0,
                  Math.min(
                    choices.length - 1,
                    current + (event.key === 'ArrowDown' ? 1 : -1),
                  ),
                ),
              );
              return;
            }
            if (open && event.key === 'Escape') {
              event.preventDefault();
              setDismissed(true);
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              if (event.shiftKey) insert('\n');
              else if (open) {
                if (choices[active]) select(choices[active]);
              } else onSend();
            }
          }}
        />
      </div>
      {open && (
        <div
          className="ws-mention-picker"
          id="steer-agent-mentions"
          role="listbox"
          aria-label={t('Delegate to an Agent on this machine')}
        >
          {choices.length ? (
            choices.map((agent, index) => (
              <button
                type="button"
                key={agent.id}
                id={`steer-agent-mention-${agent.id}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(agent)}
              >
                <span>{agent.name}</span>
                <small>{agent.runtimeProvider}</small>
              </button>
            ))
          ) : (
            <p>{t('No available Agents on this machine')}</p>
          )}
        </div>
      )}
    </div>
  );
}
