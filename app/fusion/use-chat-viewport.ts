'use client';

import { useEffect, useRef } from 'react';

// iOS keyboards resize the visual viewport without resizing the layout
// viewport. Size only the mobile chat surface, leaving page zoom available.
export function useChatViewport(onResize: () => void) {
  const surface = useRef<HTMLDivElement>(null);
  const resizeCallback = useRef(onResize);
  useEffect(() => {
    resizeCallback.current = onResize;
  }, [onResize]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const mobile = window.matchMedia('(max-width: 767px)');
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const element = surface.current;
        if (!element) return;
        // Do not counteract intentional pinch zoom or desktop resizing.
        if (
          !mobile.matches ||
          (viewport && Math.abs(viewport.scale - 1) > 0.05)
        ) {
          element.style.removeProperty('--chat-viewport-height');
          element.style.removeProperty('--chat-viewport-top');
          element.style.removeProperty('--chat-viewport-width');
          delete element.dataset.keyboardOpen;
          return;
        }
        const height = viewport?.height ?? window.innerHeight;
        element.style.setProperty('--chat-viewport-height', `${height}px`);
        element.style.setProperty(
          '--chat-viewport-top',
          `${viewport?.offsetTop ?? 0}px`,
        );
        element.style.setProperty(
          '--chat-viewport-width',
          `${viewport?.width ?? window.innerWidth}px`,
        );
        const editing =
          element.contains(document.activeElement) &&
          document.activeElement?.matches(
            '[contenteditable="true"],textarea,input',
          );
        element.dataset.keyboardOpen = String(
          Boolean(editing && window.innerHeight - height > 120),
        );
        resizeCallback.current();
      });
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    mobile.addEventListener('change', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      window.cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      mobile.removeEventListener('change', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);
  return surface;
}
