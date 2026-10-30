'use client';
import { ChevronDown } from 'lucide-react';
import type { CommissionPolicy } from '@/src/lib/sales-materials/model';
import { shanghaiToday } from '@/src/lib/sales-materials/model';
import styles from './SalesMaterials.module.css';

export default function SalesCommissionPolicies({ policies, historical = false }: {
  policies: CommissionPolicy[]; historical?: boolean;
}) {
  if (!policies.length) return <p className={styles.empty}>本份资料未提供佣金政策</p>;
  const today = shanghaiToday();
  return <div className={styles.policies}>{policies.map(policy=>{
    const expired = policy.valid_until && policy.valid_until < today;
    const future = policy.valid_from && policy.valid_from > today;
    return <article key={policy.key} className={styles.policy} aria-label={policy.title}>
      <header className={styles.policyHeader}><h3>{policy.title}</h3><span>{policy.scope}</span></header>
      {historical ? <p className={styles.caution}>历史佣金参考，非当前政策</p> : null}
      <p className={styles.policySummary}>{policy.summary}</p>
      <dl className={styles.policyFacts}>
        <div><dt>计算口径</dt><dd>{policy.basis}</dd></div>
        <div><dt>有效期</dt><dd>{policy.valid_from || policy.valid_until ? `${policy.valid_from || '起日未注明'} — ${policy.valid_until || '止日未注明'}` : '未注明'}{expired ? <strong className={styles.caution}>已过期</strong> : future ? <strong className={styles.caution}>尚未生效</strong> : null}</dd></div>
      </dl>
      <details className={styles.policyDisclosure}><summary>佣金明细<ChevronDown size={13} aria-hidden /></summary>
        <div className={styles.policyRules}>{policy.rules.map((rule,index)=><div key={index} className={styles.policyRule}>
          <div><span>{rule.label}</span><strong>{rule.reward}</strong></div>
          {rule.condition ? <p>{rule.condition}</p> : null}
          {rule.applicability === 'unconfirmed' ? <p className={styles.caution}>适用条件待确认</p> : null}
          {rule.validity_note ? <p className={rule.applicability === 'unconfirmed' ? styles.caution : undefined}>{rule.validity_note}</p> : null}
          {rule.valid_until ? <p>截至 {rule.valid_until}{rule.valid_until < today ? ' · 已过期' : ''}</p> : null}
        </div>)}</div>
        {policy.settlement ? <div className={styles.policyRule}><div>结佣条件</div><p>{policy.settlement}</p></div> : null}
        {policy.validity_note ? <p className={styles.policyTerms}>{policy.validity_note}</p> : null}
      </details>
    </article>;
  })}</div>;
}
