'use client';
import type { ProjectFact } from '@/src/lib/sales-materials/model';
import styles from './SalesMaterials.module.css';
export default function SalesProjectFacts({ facts }: {facts:ProjectFact[]}) {
  if (!facts.length) return <p className={styles.empty}>暂无项目资料</p>;
  return <dl className={styles.projectFacts}>{facts.map((fact,index)=><div key={index}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>;
}
