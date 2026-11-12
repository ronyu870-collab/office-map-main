'use client';

import * as React from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { findSchemaTables, loadSchemaGroup, loadSchemaSearch, schemaCatalog, schemaCounts, type TableDoc } from './schema-dictionary/data';

const desktopQuery = '(min-width: 768px)';
function subscribeToWidth(listener: () => void) {
  const media = window.matchMedia?.(desktopQuery);
  media?.addEventListener('change', listener);
  return () => media?.removeEventListener('change', listener);
}
const wideViewport = () => window.matchMedia?.(desktopQuery).matches ?? true;

export default function SchemaMap() {
  const [activeGroup, setActiveGroup] = React.useState(schemaCatalog[0].id);
  const [activeTable, setActiveTable] = React.useState(schemaCatalog[0].tables[0].name);
  const [search, setSearch] = React.useState('');
  const [mobileDetail, setMobileDetail] = React.useState(false);
  const [groups, setGroups] = React.useState<Record<string, TableDoc[]>>({});
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [detailAttempt, setDetailAttempt] = React.useState(0);
  const [searchRequested, setSearchRequested] = React.useState(false);
  const [searchIndex, setSearchIndex] = React.useState<Record<string, string> | null>(null);
  const [searchError, setSearchError] = React.useState(false);
  const [searchAttempt, setSearchAttempt] = React.useState(0);
  const detailPanel = React.useRef<HTMLElement>(null);
  const detailHeading = React.useRef<HTMLHeadingElement>(null);
  const listHeading = React.useRef<HTMLHeadingElement>(null);
  const focusAfterViewChange = React.useRef<'detail' | 'catalog' | null>(null);
  const desktop = React.useSyncExternalStore(subscribeToWidth, wideViewport, () => true);

  const group = schemaCatalog.find(item => item.id === activeGroup) ?? schemaCatalog[0];
  const table = group.tables.find(item => item.name === activeTable) ?? group.tables[0];
  const loadedGroup = groups[group.id];
  const details = loadedGroup?.find(item => item.name === table.name);
  const shouldLoadDetails = desktop || mobileDetail;
  const filteredGroups = React.useMemo(() => findSchemaTables(search, searchIndex), [search, searchIndex]);
  const searching = !!search.trim();

  React.useEffect(() => {
    if (!shouldLoadDetails || loadedGroup) return;
    let current = true;
    void loadSchemaGroup(group.id).then(
      data => { if (current) setGroups(previous => ({ ...previous, [group.id]: data.tables })); },
      () => { if (current) setDetailError(group.id); },
    );
    return () => { current = false; };
  }, [shouldLoadDetails, group.id, loadedGroup, detailAttempt]);

  React.useEffect(() => {
    if (!searchRequested || searchIndex) return;
    let current = true;
    void loadSchemaSearch().then(
      data => { if (current) setSearchIndex(data); },
      () => { if (current) setSearchError(true); },
    );
    return () => { current = false; };
  }, [searchRequested, searchIndex, searchAttempt]);

  React.useEffect(() => {
    if (detailPanel.current) detailPanel.current.scrollTop = 0;
  }, [table.name, mobileDetail]);

  React.useLayoutEffect(() => {
    const target = focusAfterViewChange.current;
    focusAfterViewChange.current = null;
    if (target) (target === 'detail' ? detailHeading.current : listHeading.current)?.focus({ preventScroll: true });
  }, [mobileDetail]);

  function selectGroup(id: string, firstTable: string) {
    if (id !== activeGroup) setDetailError(null);
    setActiveGroup(id);
    setActiveTable(firstTable);
  }

  function selectTable(name: string) {
    if (!desktop) focusAfterViewChange.current = 'detail';
    setActiveTable(name);
    setMobileDetail(true);
  }

  function closeMobileDetails() {
    focusAfterViewChange.current = 'catalog';
    setMobileDetail(false);
  }

  return (
    <div className="flex h-full min-w-0 overflow-hidden bg-white">
      <aside aria-label="数据字典目录" className={`min-w-0 flex-1 flex-col md:w-64 md:flex-none md:border-r md:border-zinc-200 ${mobileDetail ? 'hidden md:flex' : 'flex'}`}>
        <div className="shrink-0 border-b border-zinc-100 px-4 py-3">
          <h2 tabIndex={-1} ref={listHeading} className="text-sm font-semibold text-zinc-700 focus:outline-none">数据字典</h2>
          <p className="mt-0.5 text-xs text-zinc-500">{schemaCounts.tables} 张表 / {schemaCounts.fields} 个字段</p>
          <input
            type="text"
            value={search}
            aria-label="搜索表名或字段"
            onChange={event => {
              setSearch(event.target.value);
              if (event.target.value.trim()) setSearchRequested(true);
            }}
            placeholder="搜索表名或字段..."
            className="mt-2 min-h-11 w-full rounded-md border border-zinc-200 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none md:min-h-0"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-2 py-1">
          {searching && !searchIndex && (
            <div className="px-3 py-2 text-xs text-zinc-600">
              {searchError ? (
                <div role="alert" className="flex flex-wrap items-center gap-2">
                  <span>字段搜索暂时不可用，仍可查找表名</span>
                  <button type="button" className="min-h-11 text-blue-700 underline md:min-h-8" onClick={() => {
                    setSearchError(false);
                    setSearchAttempt(attempt => attempt + 1);
                  }}>重试字段搜索</button>
                </div>
              ) : <p role="status">正在准备字段搜索…</p>}
            </div>
          )}
          {searching && searchIndex && filteredGroups.length === 0 && <p role="status" className="px-3 py-3 text-sm text-zinc-500">未找到匹配的表或字段</p>}
          {filteredGroups.map(item => (
            <div key={item.id} className="mb-1">
              <button type="button" aria-expanded={activeGroup === item.id} aria-controls={`schema-group-${item.id}`}
                className={`min-h-11 w-full rounded-md px-3 py-1.5 text-left text-sm font-semibold transition-colors md:min-h-8 ${
                  activeGroup === item.id ? 'bg-blue-50 text-blue-700' : 'text-zinc-600 hover:bg-zinc-50'
                }`}
                onClick={() => selectGroup(item.id, item.tables[0].name)}>
                {item.title}
                <span className="ml-1 font-normal text-zinc-500">({item.tables.length})</span>
              </button>
              <div id={`schema-group-${item.id}`} hidden={activeGroup !== item.id} className="ml-2 mt-0.5 space-y-0.5">
                {activeGroup === item.id && item.tables.map(entry => (
                  <button type="button" key={entry.name} aria-current={activeTable === entry.name ? 'true' : undefined}
                    onClick={() => selectTable(entry.name)}
                    className={`min-h-11 w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors md:min-h-8 ${
                      activeTable === entry.name ? 'bg-blue-100 font-medium text-blue-700' : 'text-zinc-600 hover:bg-zinc-50'
                    }`}>
                    {entry.label}
                    <span className="ml-1 text-zinc-500">{entry.fieldCount}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <section aria-label="表详情" ref={detailPanel} className={`min-w-0 flex-1 overflow-auto ${mobileDetail ? 'block' : 'hidden md:block'}`}>
        <div className="mx-auto max-w-4xl px-4 py-4 md:px-8 md:py-6">
          <button type="button" onClick={closeMobileDetails} className="mb-2 inline-flex min-h-11 items-center gap-2 text-sm text-blue-700 md:hidden">
            <ArrowLeft size={16} aria-hidden="true" /> 返回数据字典
          </button>
          <div className="mb-1 break-words font-mono text-xs text-zinc-500">{table.name}</div>
          <h1 tabIndex={-1} ref={detailHeading} className="text-lg font-semibold text-zinc-800 focus:outline-none">{table.label}</h1>
          {details ? <TableDetails key={table.name} table={details} /> : shouldLoadDetails && (
            detailError === group.id ? (
              <div role="alert" className="mt-4 flex flex-wrap items-center gap-2 text-sm text-red-800">
                <span>表详情暂时无法加载</span>
                <button type="button" className="min-h-11 font-medium underline md:min-h-8" onClick={() => {
                  setDetailError(null);
                  setDetailAttempt(attempt => attempt + 1);
                }}>重试表详情</button>
              </div>
            ) : <p role="status" className="mt-4 text-sm text-zinc-500">正在加载字段和规则…</p>
          )}
        </div>
      </section>
    </div>
  );
}

function TableDetails({ table }: { table: TableDoc }) {
  const [expandedField, setExpandedField] = React.useState<string | null>(null);
  return (
    <>
      <p className="mb-5 mt-1 text-sm text-zinc-600">{table.desc}</p>
      {table.rules?.length ? (
        <section aria-label="业务规则" className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <h2 className="mb-2 font-semibold">业务规则</h2>
          <ol className="list-decimal space-y-1 pl-5">{table.rules.map(rule => <li key={rule}>{rule}</li>)}</ol>
        </section>
      ) : null}
      <div className="min-w-0 overflow-hidden rounded-lg border border-zinc-200">
        <table role="table" aria-label={`${table.label}字段`} className="block w-full text-sm md:table">
          <thead className="sr-only md:not-sr-only md:table-header-group">
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-zinc-600">
              <th scope="col" className="w-44 px-4 py-2.5 font-semibold">字段名</th>
              <th scope="col" className="w-32 px-4 py-2.5 font-semibold">中文名</th>
              <th scope="col" className="w-20 px-4 py-2.5 font-semibold">类型</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">说明</th>
            </tr>
          </thead>
          <tbody role="rowgroup" className="block md:table-row-group">
            {table.fields.map(field => {
              const isOpen = expandedField === field.name;
              const expandable = Boolean(field.who || field.note);
              const detailId = `schema-field-${table.name}-${field.name}`;
              return (
                <React.Fragment key={field.name}>
                  <tr role="row" className={`grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] items-center border-b border-zinc-100 px-3 py-2 md:table-row md:p-0 ${expandable ? 'cursor-pointer hover:bg-zinc-50' : ''}`}
                    onClick={expandable ? () => setExpandedField(isOpen ? null : field.name) : undefined}>
                    <td role="cell" className="min-w-0 break-all pr-2 font-mono text-xs text-zinc-700 md:px-4 md:py-2">
                      {expandable ? (
                        <button type="button" aria-expanded={isOpen} aria-controls={isOpen ? detailId : undefined} aria-label={`${isOpen ? '收起' : '展开'}字段 ${field.name}`}
                          onClick={event => { event.stopPropagation(); setExpandedField(isOpen ? null : field.name); }}
                          className="flex min-h-11 items-center gap-1 text-left md:min-h-7">
                          <ChevronRight size={13} className={`shrink-0 text-zinc-500 ${isOpen ? 'rotate-90' : ''}`} aria-hidden="true" />
                          <span>{field.name}</span>
                        </button>
                      ) : field.name}
                    </td>
                    <td role="cell" className="min-w-0 break-words pr-2 text-zinc-800 md:px-4 md:py-2">{field.label}</td>
                    <td role="cell" className="text-xs text-zinc-600 md:px-4 md:py-2">{field.type}</td>
                    <td role="cell" className="col-span-3 break-words text-zinc-600 md:px-4 md:py-2">{field.desc}</td>
                  </tr>
                  {expandable && isOpen && (
                    <tr id={detailId} className="bg-zinc-50/70">
                      <td colSpan={4} className="px-4 py-3 text-xs text-zinc-700">
                        <div className="flex flex-wrap gap-x-8 gap-y-1">
                          {field.who && <p>填写方：{field.who}</p>}
                          {field.note && <p>备注：{field.note}</p>}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
