'use client';

import { Bot, Folder, MessageSquare, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { Popover } from '@base-ui/react/popover';

export function GettingStarted({
  open,
  completed,
  onStep,
  onSkip,
  onShown,
}: {
  open: boolean;
  completed: boolean[];
  onStep: (step: number) => void;
  onSkip: () => void;
  onShown: () => void;
}) {
  const { t } = useI18n();
  const steps = [
    {
      title: 'Connect a machine',
      description:
        'Install Relay Node on the machine where your Agent tools are available, then add its Runtimes to this workspace.',
      action: 'Add Runtime',
      icon: Server,
    },
    {
      title: 'Create your first Agent',
      description:
        'Choose a Runtime and model, then give your Agent a name and instructions.',
      action: 'Create Agent',
      icon: Bot,
    },
    {
      title: 'Add your project',
      description:
        'Select a directory on your machine or connect a Git repository. Your conversations will live under this project.',
      action: 'Add project',
      icon: Folder,
    },
    {
      title: 'Start a conversation',
      description:
        'Choose your Agent and project, then describe the first task you want to work on.',
      action: 'Start chatting',
      icon: MessageSquare,
    },
  ];
  const next = completed.findIndex((done) => !done);
  const current = next === -1 ? 3 : next;
  const step = steps[current];
  const Icon = step.icon;

  const [anchor, setAnchor] = useState<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    const selector = `[data-onboarding="${['runtime', 'agent', 'project', 'chat'][current]}"]`;
    let highlighted: Element | null = null;
    const find = () => {
      const target = document.querySelector(selector);
      if (target === highlighted) return;
      highlighted?.classList.remove('ws-onboarding-target');
      highlighted = target;
      setAnchor(target);
      target?.classList.add('ws-onboarding-target');
      target?.scrollIntoView({ block: 'nearest' });
    };
    const frame = window.requestAnimationFrame(find);
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      highlighted?.classList.remove('ws-onboarding-target');
    };
  }, [open, current]);
  useEffect(() => {
    if (!open || !anchor) return;
    const frame = window.requestAnimationFrame(onShown);
    return () => window.cancelAnimationFrame(frame);
  }, [open, anchor, onShown]);
  return (
    <Popover.Root open={open && Boolean(anchor)} modal={false}>
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          side={current === 2 ? 'right' : current === 3 ? 'top' : 'bottom'}
          align="start"
          sideOffset={12}
          className="ws-onboarding-positioner"
        >
          <Popover.Popup
            className="ws-getting-started-dialog"
            initialFocus={false}
          >
            <div
              className="ws-getting-started-progress"
              aria-label={t('Setup progress')}
            >
              <span>
                {t('Getting started')} · {current + 1} / {steps.length}
              </span>
              <div aria-hidden="true">
                {steps.map((item, index) => (
                  <i
                    key={item.title}
                    className={index <= current ? 'is-active' : ''}
                  />
                ))}
              </div>
            </div>
            <Popover.Title className="ws-onboarding-title">
              <Icon aria-hidden="true" />
              {t(step.title)}
            </Popover.Title>
            <Popover.Description className="ws-onboarding-description">
              {t(step.description)}
            </Popover.Description>
            <div className="ws-getting-started-actions">
              <Button variant="ghost" onClick={onSkip}>
                {t('Skip for now')}
              </Button>
              <Button onClick={() => onStep(current)}>{t(step.action)}</Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
