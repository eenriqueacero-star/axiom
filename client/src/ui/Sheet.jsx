import { useEffect } from 'react';

/**
 * A detail panel that springs up over the living floor. Mobile: from the bottom.
 * Desktop: it's still bottom-anchored inside the app frame, which is fine at our
 * widths. Scrim dims and blurs the floor behind it.
 */
export default function Sheet({ open, onClose, children, labelledBy }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
        className={`fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md
          bg-panel border-t border-line-2 rounded-t-[22px]
          max-h-[82dvh] overflow-y-auto
          px-5 pt-2 pb-[calc(28px+env(safe-area-inset-bottom))]
          transition-transform duration-[380ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]
          ${open ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-line-2" />
        {open && children}
      </div>
    </>
  );
}
