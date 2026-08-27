'use client';

interface TagFilterProps {
  tags: string[];
  selected: string | null;
  onChange: (tag: string | null) => void;
}

export function TagFilter({ tags, selected, onChange }: TagFilterProps) {
  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 py-2">
      <button
        onClick={() => onChange(null)}
        className={`rounded-full border px-2.5 py-0.5 text-[var(--cd-font-size-xs)] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] ${
          selected === null
            ? 'border-[var(--cd-color-brand)] bg-[var(--cd-color-brand)] text-white'
            : 'border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)]'
        }`}
      >
        全部
      </button>
      {tags.map((tag) => (
        <button
          key={tag}
          onClick={() => onChange(tag === selected ? null : tag)}
          className={`rounded-full border px-2.5 py-0.5 text-[var(--cd-font-size-xs)] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] ${
            selected === tag
              ? 'border-[var(--cd-color-brand)] bg-[var(--cd-color-brand)] text-white'
              : 'border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-brand-soft)] hover:text-[var(--cd-color-brand)]'
          }`}
        >
          {tag}
        </button>
      ))}
    </div>
  );
}
