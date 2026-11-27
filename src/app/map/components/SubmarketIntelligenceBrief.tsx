import { ExternalLink } from 'lucide-react';
import type { SubmarketIntelligence } from '../model/submarketIntelligence';

const scopeLabels = {
  administrative: '行政区', functional: '功能区', project: '单个项目', network: '交通网络', external_market: '外部报告口径',
};

// A market overview is an editorial decision brief, not just the first note.
const overviewObservationLimit = 4;

export function SubmarketOverviewResearch({ research }: { research: SubmarketIntelligence }) {
  const observations = research.observations.slice(0, overviewObservationLimit);
  if (!observations.length) return null;
  const sources = research.sources.filter(source => observations.some(item => item.sourceIds.includes(source.id)));
  return <section className="submarket-intelligence-lead" aria-label="市场观察">
    {observations.map((item, index) => <div key={item.title}>
      <h3>{item.title}</h3><p>{item.body}</p>
      {item.kind === 'outlook' ? <p className="submarket-profile-meta">前瞻判断 · {item.asOf}</p> : null}
      {index === 0 ? <p className="submarket-profile-meta">{item.asOf} · {item.scope}</p> : null}
    </div>)}
    <details className="submarket-intelligence-sources">
      <summary>研究依据与口径</summary>
      {observations.map(item => <div key={item.title}>
        <h4>{item.title}</h4><p className="submarket-profile-meta">{item.asOf} · {item.scope}</p>
        <p>{item.limitation}</p>
        <p className="submarket-profile-meta">{sources.filter(source => item.sourceIds.includes(source.id)).map(source => source.publisher).join('、')}</p>
      </div>)}
      <ol>{sources.map(source => <li key={source.id}>
        <a className="submarket-link-action" href={source.url} target="_blank" rel="noopener noreferrer">{source.title} <ExternalLink size={13} aria-hidden="true" /></a>
        <p className="submarket-profile-meta">{source.publisher} · {source.observedAt} · {source.scope}</p>
      </li>)}</ol>
    </details>
  </section>;
}

export function SubmarketIntelligenceBrief({ research, leadShown = false }: { research: SubmarketIntelligence; leadShown?: boolean }) {
  const sourceIndex = new Map(research.sources.map((source, index) => [source.id, index + 1]));
  const renderSources = (ids: string[]) => <ul className="submarket-intelligence-cites" aria-label="依据">
    {ids.map(id => {
      const source = research.sources.find(item => item.id === id);
      return source ? <li key={id}>
        <a href={source.url} target="_blank" rel="noopener noreferrer" aria-label={source.title}>[{sourceIndex.get(id)}]</a>
      </li> : null;
    })}
  </ul>;

  const observations = leadShown ? research.observations.slice(overviewObservationLimit) : research.observations;
  return <div className="submarket-intelligence">
    {observations.length > 0 ? <section aria-label="市场观察" className="submarket-intelligence-observations">
      {observations.map(item => <div key={item.title}>
        <h4>{item.title}</h4>
        <p>{item.body}</p>
        {item.kind === 'outlook' ? <p className="submarket-profile-meta">前瞻判断 · {item.asOf}</p> : null}
        <p className="submarket-profile-meta">{item.limitation}</p>
        {renderSources(item.sourceIds)}
      </div>)}
    </section> : null}
    <dl className="submarket-intelligence-facts">
      {research.facts.map(item => <div key={item.title}>
        <dt>{item.title}{item.status === 'planned' ? <span className="submarket-profile-meta"> · 规划／工程资料</span> : null}</dt>
        {item.measure ? <dd><strong>{item.measure.value}</strong> {item.measure.unit}</dd> : null}
        {item.lines ? <dd className="submarket-intelligence-lines">{item.lines.map(line => <span key={line}>{line}</span>)}</dd> : null}
        <dd>{item.body}</dd>
        <dd>{renderSources(item.sourceIds)}</dd>
      </div>)}
    </dl>
    <details className="submarket-intelligence-sources">
      <summary>来源与口径（{research.sources.length}）</summary>
      <ol>
        {research.sources.map(source => <li key={source.id}>
          <a className="submarket-link-action" href={source.url} target="_blank" rel="noopener noreferrer">
            {source.title} <ExternalLink size={13} aria-hidden="true" />
          </a>
          <p>{source.publisher} · {source.publishedOn ?? '发布日期未标注'}</p>
          <p>{scopeLabels[source.scopeType]} · {source.scope} · {source.observedAt}</p>
          <p>{source.basis}</p>
          <p className="submarket-profile-meta">核验于 {source.verifiedOn}</p>
        </li>)}
      </ol>
    </details>
  </div>;
}
