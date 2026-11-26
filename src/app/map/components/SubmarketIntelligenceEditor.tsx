import * as React from 'react';
import { fetchSubmarketResearchHistory } from '@/src/services/mapDataClient';
import { normalizeMapSubmarket } from '../model/marketIdentity';
import type { MarketBuilding } from '../model/marketStatistics';
import { researchFocus, type SubmarketIntelligence, type SubmarketResearchVersion } from '../model/submarketIntelligence';
import { SubmarketEditorField as Field } from './SubmarketEditorField';

const focusLabels = ['甲乙级租金差', '同样本租金变化', '同样本空置率变化', '存量项目构成'];
const factLabels = { place: '区位与载体', industry: '产业', policy: '政策', transit: '交通', supply: '供应' } as const;
const scopeLabels = { administrative: '行政区', functional: '功能区', project: '项目', network: '交通网络', external_market: '外部报告口径' } as const;
const observationLabels = { inference: '研究推断', outlook: '未来判断' } as const;
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());

function Choice<K extends string>({ label, value, values, onChange }: {
  label: string; value: K; values: ReadonlyArray<readonly [K, string]>; onChange: (value: K) => void;
}) {
  return <label>{label}
    <select value={value} onChange={event => onChange(event.currentTarget.value as K)}>
      {values.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
    </select>
  </label>;
}

export function SubmarketIntelligenceEditor({ name, research, buildings, disabled, onChange }: {
  name: string;
  research: SubmarketIntelligence | null;
  buildings: readonly MarketBuilding[];
  disabled: boolean;
  onChange: (research: SubmarketIntelligence | null) => void;
}) {
  const [history, setHistory] = React.useState<SubmarketResearchVersion[] | null>(null);
  const [offset, setOffset] = React.useState<number | null>(0);
  const [historyState, setHistoryState] = React.useState<'loading' | 'error' | 'ready'>('ready');
  const request = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => request.current?.abort(), []);
  async function loadHistory() {
    if (offset === null || historyState === 'loading') return;
    const controller = new AbortController();
    request.current = controller;
    setHistoryState('loading');
    try {
      const page = await fetchSubmarketResearchHistory(name, offset, controller.signal);
      if (controller.signal.aborted) return;
      setHistory(previous => [...(previous ?? []), ...page.versions]);
      setOffset(page.nextOffset);
      setHistoryState('ready');
    } catch {
      if (!controller.signal.aborted) setHistoryState('error');
    }
  }

  const projects = buildings.flatMap(building => building.id && normalizeMapSubmarket(building.submarket) === name
    ? [[building.id, building.name ?? building.id] as const] : []);
  const emptyProject = { buildingId: projects[0]?.[0] ?? '', role: '', reason: '', sourceIds: [] };
  const update = (patch: Partial<SubmarketIntelligence>) => {
    if (research) onChange({ ...research, ...patch });
  };

  const entries = <T,>(label: string, rows: T[], limit: number, empty: T, change: (rows: T[]) => void,
    field: (row: T, update: (row: T) => void) => React.ReactNode) => <details className="submarket-intelligence-editor-group">
    <summary>{label}（{rows.length}）</summary>
    {rows.map((row, index) => <fieldset key={index}>
      <legend>{label} {index + 1}</legend>
      {field(row, next => change(rows.map((old, position) => position === index ? next : old)))}
      <button type="button" className="submarket-quiet-action" onClick={() => change(rows.filter((_, position) => position !== index))}>删除{label}</button>
    </fieldset>)}
    <button type="button" className="submarket-quiet-action" disabled={rows.length >= limit} onClick={() => change([...rows, empty])}>添加{label}</button>
  </details>;

  const sourceChoices = (ids: string[], save: (ids: string[]) => void) => <fieldset className="submarket-intelligence-source-choices">
    <legend>引用来源</legend>
    {research?.sources.length ? research.sources.map((source, index) => <label key={index}>
      <input type="checkbox" checked={ids.includes(source.id)}
        onChange={event => save(event.currentTarget.checked ? [...ids, source.id] : ids.filter(id => id !== source.id))} />
      {source.title || source.id || '未命名来源'}
    </label>) : <p>先添加来源。</p>}
  </fieldset>;

  return <fieldset className="submarket-intelligence-editor" disabled={disabled}>
    <legend>结构化研究</legend>
    {research ? <>
      <Field label="市场定位" value={research.positioning} onChange={positioning => update({ positioning })} />
      <Field label="研究更新日期" value={research.updatedOn} onChange={updatedOn => update({ updatedOn })} />
      <Choice label="行情观察" value={research.focus} values={researchFocus.map((key, index) => [key, focusLabels[index]])}
        onChange={focus => update({ focus })} />
      {entries('来源', research.sources, 20, {
        id: '', title: '', publisher: '', url: '', publishedOn: null, observedAt: '', verifiedOn: today(),
        scope: '', scopeType: 'functional', basis: '',
      }, sources => update({ sources }), (row, set) => <>
        <Field label="引用编号（英文字母、数字和连字符）" value={row.id} onChange={id => {
          const rewrite = <T extends { sourceIds: string[] }>(items: T[]) => items.map(item => ({
            ...item, sourceIds: item.sourceIds.map(sourceId => sourceId === row.id ? id : sourceId),
          }));
          update({ sources: research.sources.map(source => source === row ? { ...row, id } : source),
            facts: rewrite(research.facts), observations: rewrite(research.observations), projects: rewrite(research.projects) });
        }} />
        <Field label="来源标题" value={row.title} onChange={title => set({ ...row, title })} />
        <Field label="发布机构" value={row.publisher} onChange={publisher => set({ ...row, publisher })} />
        <Field label="原文链接" value={row.url} onChange={url => set({ ...row, url })} />
        <Field label="发布日期（YYYY-MM-DD，可留空）" value={row.publishedOn ?? ''} onChange={date => set({ ...row, publishedOn: date || null })} />
        <Field label="观测或适用时期" value={row.observedAt} onChange={observedAt => set({ ...row, observedAt })} />
        <Field label="核验日期（YYYY-MM-DD）" value={row.verifiedOn} onChange={verifiedOn => set({ ...row, verifiedOn })} />
        <Choice label="地域口径" value={row.scopeType} values={Object.entries(scopeLabels) as [typeof row.scopeType, string][]}
          onChange={scopeType => set({ ...row, scopeType })} />
        <Field label="适用范围" value={row.scope} onChange={scope => set({ ...row, scope })} />
        <Field label="证据摘要" value={row.basis} multi onChange={basis => set({ ...row, basis })} />
      </>)}
      {entries('事实', research.facts, 16, { title: '', body: '', kind: 'place', status: 'observed', sourceIds: [] },
        facts => update({ facts }), (row, set) => <>
          <Field label="事实标题" value={row.title} onChange={title => set({ ...row, title })} />
          <Field label="事实内容" value={row.body} multi onChange={body => set({ ...row, body })} />
          <Choice label="事实类型" value={row.kind} values={Object.entries(factLabels) as [typeof row.kind, string][]}
            onChange={kind => set({ ...row, kind, lines: kind === 'transit' ? row.lines : undefined })} />
          <Choice label="现状" value={row.status} values={[[ 'observed', '已发生或投用'], ['planned', '规划或建设中']]}
            onChange={status => set({ ...row, status, measure: status === 'observed' ? row.measure : undefined })} />
          {row.status === 'observed' ? <>
            <Field label="指标值（可选）" value={row.measure?.value ?? ''} onChange={value => set({ ...row, measure: value ? { value, unit: row.measure?.unit ?? '' } : undefined })} />
            {row.measure ? <Field label="指标单位" value={row.measure.unit} onChange={unit => set({ ...row, measure: { value: row.measure!.value, unit } })} /> : null}
          </> : null}
          {row.kind === 'transit' ? <Field label="线路（逗号分隔，可选）" value={row.lines?.join(',') ?? ''}
            onChange={lines => set({ ...row, lines: lines ? lines.split(/[,，]/) : undefined })} /> : null}
          {sourceChoices(row.sourceIds, sourceIds => set({ ...row, sourceIds }))}
        </>)}
      {entries('观点', research.observations, 8, { title: '', body: '', kind: 'inference', asOf: today(), scope: name, limitation: '', sourceIds: [] },
        observations => update({ observations }), (row, set) => <>
          <Field label="观点标题" value={row.title} onChange={title => set({ ...row, title })} />
          <Field label="观点正文" value={row.body} multi onChange={body => set({ ...row, body })} />
          <Choice label="观点类型" value={row.kind} values={Object.entries(observationLabels) as [typeof row.kind, string][]}
            onChange={kind => set({ ...row, kind })} />
          <Field label="适用时期" value={row.asOf} onChange={asOf => set({ ...row, asOf })} />
          <Field label="适用范围" value={row.scope} onChange={scope => set({ ...row, scope })} />
          <Field label="证据边界" value={row.limitation} onChange={limitation => set({ ...row, limitation })} />
          {sourceChoices(row.sourceIds, sourceIds => set({ ...row, sourceIds }))}
        </>)}
      {entries('代表项目', research.projects, projects.length ? 8 : research.projects.length, emptyProject,
        rows => update({ projects: rows }), (row, set) => <>
          <Choice label="楼宇" value={row.buildingId} values={projects.some(([id]) => id === row.buildingId)
            ? projects : [[row.buildingId, '当前名录未找到该项目'], ...projects]} onChange={buildingId => set({ ...row, buildingId })} />
          <Field label="代表性" value={row.role} onChange={role => set({ ...row, role })} />
          <Field label="选择依据" value={row.reason} multi onChange={reason => set({ ...row, reason })} />
          {sourceChoices(row.sourceIds, sourceIds => set({ ...row, sourceIds }))}
        </>)}
    </> : <button type="button" className="submarket-quiet-action" onClick={() => onChange({
      version: 1, market: name, positioning: '', updatedOn: today(), focus: 'stock', sources: [], facts: [], observations: [], projects: [],
    })}>新建结构化研究</button>}
    {history?.map(entry => <div key={entry.id} className="submarket-intelligence-version">
      <span>{entry.savedAt.slice(0, 10)} · {entry.research?.positioning ?? '旧版区域资料'} · {entry.wasPublished ? '已展示' : '草稿'}</span>
      <button type="button" className="submarket-quiet-action" onClick={() => {
        if (window.confirm('载入此版本会替换当前表单中的结构化资料。保存并展示后才会生效。')) onChange(entry.research);
      }}>载入版本</button>
    </div>)}
    {historyState === 'error' ? <p role="alert">版本读取失败，请重试。</p> : null}
    {history?.length === 0 ? <p>暂无更早版本。</p> : null}
    {offset !== null ? <button type="button" className="submarket-quiet-action" disabled={historyState === 'loading'} onClick={loadHistory}>
      {historyState === 'loading' ? '正在读取版本…' : history ? '查看较早版本' : '查看历史版本'}
    </button> : null}
  </fieldset>;
}
