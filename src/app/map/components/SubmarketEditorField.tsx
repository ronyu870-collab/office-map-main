export function SubmarketEditorField({ label, value, onChange, multi = false, placeholder }: {
  label: string; value: string; onChange: (value: string) => void; multi?: boolean; placeholder?: string;
}) {
  const common = 'mt-1 w-full rounded-[6px] border border-[#c3ccd8] bg-white px-2.5 py-2 text-[14px] text-[#172033] outline-none focus:border-[#003e7e] focus:ring-1 focus:ring-[#003e7e]';
  return (
    <label className="block min-w-0 text-[14px] font-normal text-[#475569]">
      {label}
      {multi
        ? <textarea rows={3} className={common} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
        : <input className={common} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />}
    </label>
  );
}
