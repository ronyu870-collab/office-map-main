import type { SubmarketIntelligence } from '../model/submarketIntelligence';
import { customerResearchText } from '../model/submarketResearchPresentation';

const overviewObservationLimit = 4;

// Customer reading surfaces deliberately render only editorial content. Evidence,
// citation IDs, source links and review metadata belong in the maintenance editor.
function ResearchObservations({ observations, research, lead = false }: {
  research: SubmarketIntelligence;
  observations: SubmarketIntelligence['observations'];
  lead?: boolean;
}) {
  if (!observations.length) return null;
  const Heading = lead ? 'h3' : 'h4';
  return <section aria-label="市场观察" className={lead ? 'submarket-intelligence-lead' : 'submarket-intelligence-observations'}>
    {observations.map(item => <div key={item.title}>
      <Heading>{item.kind === 'outlook' && !item.title.includes('展望') ? '展望：' : ''}{customerResearchText(item.title, research)}</Heading>
      <p>{customerResearchText(item.body, research)}</p>
    </div>)}
  </section>;
}

export function SubmarketOverviewResearch({ research }: { research: SubmarketIntelligence }) {
  return <ResearchObservations research={research} observations={research.observations.slice(0, overviewObservationLimit)} lead />;
}

export function SubmarketIntelligenceBrief({ research, leadShown = false }: {
  research: SubmarketIntelligence;
  leadShown?: boolean;
}) {
  const observations = leadShown ? research.observations.slice(overviewObservationLimit) : research.observations;
  return <div className="submarket-intelligence">
    <ResearchObservations research={research} observations={observations} />
    <dl className="submarket-intelligence-facts">
      {research.facts.map(item => <div key={item.title}>
        <dt>{customerResearchText(item.title, research)}{item.status === 'planned' ? '（规划）' : ''}</dt>
        {item.measure ? <dd><strong>{item.measure.value}</strong> {item.measure.unit}</dd> : null}
        {item.lines ? <dd className="submarket-intelligence-lines">{item.lines.map(line => <span key={line}>{customerResearchText(line, research)}</span>)}</dd> : null}
        <dd>{customerResearchText(item.body, research)}</dd>
      </div>)}
    </dl>
  </div>;
}
