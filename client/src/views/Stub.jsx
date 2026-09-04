import Icon from '../ui/Icon';

/** Placeholder for a surface still being built on the redesign branch. */
export default function Stub({ icon, title, note, items }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full border border-line-2 text-muted">
        <Icon name={icon} size={22} />
      </span>
      <h2 className="mt-4 mono text-xs tracking-[0.16em] text-text">{title}</h2>
      <p className="mt-2 max-w-[46ch] text-[12px] leading-relaxed text-muted">{note}</p>
      {items && (
        <ul className="mt-4 space-y-1.5 text-left">
          {items.map((t) => (
            <li key={t} className="flex items-center gap-2 text-[11px] text-faint">
              <Icon name="chevron" size={11} /> {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
