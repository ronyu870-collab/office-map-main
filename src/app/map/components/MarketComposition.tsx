import { researchNumber } from '../model/submarketResearch';
import styles from './SubmarketResearchData.module.css';

export function MarketComposition({ segments }: { segments: readonly { label: string; count: number }[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  return <>
    {total > 0 && <div className={styles.compositionBar} aria-hidden="true">
      {segments.map(({ label, count }) => <i key={label} style={{ flexGrow: count }} />)}
    </div>}
    <dl className={styles.facts}>
      {segments.map(({ label, count }) => <div key={label}><dt>{label}</dt><dd>{researchNumber(count, 0)} 个</dd></div>)}
    </dl>
  </>;
}
