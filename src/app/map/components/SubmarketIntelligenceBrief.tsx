import { ExternalLink } from 'lucide-react';
import type { SubmarketIntelligence } from '../model/submarketIntelligence';

const scopeLabels = {
  administrative: '行政区', functional: '功能区', project: '单个项目', network: '交通网络', external_market: '外部报告口径',
};

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

  return <div className="submarket-intelligence">
    <section aria-label="市场观察" className="submarket-intelligence-observations">
      {research.observations.map(item => <div key={item.title}>
        <h4>{item.title}</h4>
        {!(leadShown && item === research.observations[0]) ? <p>{item.body}</p> : null}
        {item.kind === 'outlook' ? <p className="submarket-profile-meta">前瞻判断 · {item.asOf}</p> : null}
        <p className="submarket-profile-meta">{item.limitation}</p>
        {renderSources(item.sourceIds)}
      </div>)}
    </section>
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
