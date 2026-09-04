import { useEffect } from 'react';
import { useMedia } from '../hooks/useMedia';

/**
 * A detail panel over the living floor.
 * Mobile: springs up from the bottom. Desktop: slides in from the right,
 * full height, so the floor stays visible beside it.
 */
export default function Sheet({ open, onClose, children, labelledBy }) {
  const desktop = useMedia('(min-width: 860px)');

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const panel = desktop
    ? `right-0 top-0 h-dvh w-[400px] max-w-[92vw] border-l border-line-2 rounded-none
       ${open ? 'translate-x-0' : 'translate-x-full'}`
    : `inset-x-0 bottom-0 mx-auto w-full max-w-md border-t border-line-2 rounded-t-[22px]
       max-h-[82dvh]
       ${open ? 'translate-y-0' : 'translate-y-full'}`;

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px] transition-opacity duration-300
          ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`fixed z-50 overflow-y-auto bg-panel px-5 pt-2
          pb-[calc(28px+env(safe-area-inset-bottom))]
          transition-transform duration-[380ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]
          ${panel}`}
      >
        {!desktop && <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-line-2" />}
        {desktop && (
          <button onClick={onClose}
            className="mb-3 ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted hover:text-text">
            <svg viewBox="0 0 20 20" width="14" height="14" fill="none">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {open && children}
      </div>
    </>
  );
}
