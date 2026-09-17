'use client';

import { useEffect, useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { steer, type SharedConversation } from '@/lib/steer-client';
import styles from './share.module.css';

export default function SharedConversationPage() {
  const [share, setShare] = useState<SharedConversation | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token =
      new URLSearchParams(window.location.search).get('token') || '';
    let cancelled = false;
    if (!token) {
      queueMicrotask(() => {
        if (cancelled) return;
        setError('This share link is unavailable.');
        setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }
    void steer
      .sharedConversation(token)
      .then((result) => {
        if (!cancelled) setShare(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : 'This share link is unavailable.',
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          <span>Steer</span>
        </Link>
        <span className={styles.readOnly}>Shared · Read only</span>
      </header>
      <section className={styles.content}>
        {loading ? (
          <output className={styles.state}>Loading shared content…</output>
        ) : error || !share ? (
          <div className={styles.empty} role="alert">
            <MessageSquareText aria-hidden="true" />
            <h1>Share unavailable</h1>
            <p>{error || 'This share link is unavailable.'}</p>
          </div>
        ) : (
          <>
            <div className={styles.title}>
              <span>
                {share.scope === 'conversation'
                  ? 'Shared conversation'
                  : 'Shared message'}
              </span>
              <h1>{share.title}</h1>
              <time dateTime={share.createdAt}>
                Shared {formatSharedDate(share.createdAt)}
              </time>
            </div>
            <div className={styles.messages}>
              {share.messages.map((message, index) => (
                <article
                  className={
                    message.role === 'user' ? styles.user : styles.agent
                  }
                  key={`${message.role}-${message.createdAt}-${index}`}
                >
                  <div className={styles.messageContent}>
                    {message.role === 'agent' && (
                      <div className={styles.responseProcess}>
                        <div className={styles.responseMeta}>
                          {sharedResponseStatus(message)}
                        </div>
                        <div
                          className={styles.responseDivider}
                          aria-hidden="true"
                        />
                      </div>
                    )}
                    <div className={styles.markdown}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ children, ...props }) => (
                            <a
                              {...props}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function formatSharedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function sharedResponseStatus(
  message: SharedConversation['messages'][number],
) {
  const elapsed = formatElapsed(message.createdAt, message.updatedAt);
  if (!message.status) return elapsed ? `Completed in ${elapsed}` : 'Completed';
  if (message.status === 'failed')
    return elapsed ? `Failed after ${elapsed}` : 'Failed';
  if (message.status === 'cancelled')
    return elapsed ? `Stopped after ${elapsed}` : 'Stopped';
  return elapsed ? `Completed in ${elapsed}` : 'Completed';
}

function formatElapsed(start?: string, end?: string) {
  if (!start || !end) return '';
  const startedAt = new Date(start).getTime();
  const endedAt = new Date(end).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return '';
  const totalSeconds = Math.max(1, Math.round((endedAt - startedAt) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
