'use client';
import type { ProjectFact } from '@/src/lib/sales-materials/model';
import styles from './SalesMaterials.module.css';
export default function SalesProjectFacts({ facts, showSources = false }: {facts:ProjectFact[];showSources?:boolean}) {
  if (!facts.length) return <p className={styles.empty}>暂无项目资料</p>;
  return <><dl className={styles.projectFacts}>{facts.map((fact,index)=><div key={index}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>{showSources ? <details className={styles.policyDisclosure}><summary>资料来源</summary>{facts.map((fact,index)=><p key={index}>{fact.label}：{fact.source_ref}</p>)}</details> : null}</>;
}
