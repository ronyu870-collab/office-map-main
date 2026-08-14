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
        className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
          selected === null
            ? 'bg-zinc-900 text-white'
            : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
        }`}
      >
        全部
      </button>
      {tags.map((tag) => (
        <button
          key={tag}
          onClick={() => onChange(tag === selected ? null : tag)}
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
            selected === tag
              ? 'bg-blue-600 text-white'
              : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
          }`}
        >
          {tag}
        </button>
      ))}
    </div>
  );
}
