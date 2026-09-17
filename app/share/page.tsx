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
                  <header>
                    <strong>{message.role === 'user' ? 'You' : 'Agent'}</strong>
                    <time dateTime={message.createdAt}>
                      {formatMessageDate(message.createdAt)}
                    </time>
                  </header>
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

function formatMessageDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
