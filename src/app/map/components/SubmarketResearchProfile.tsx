import { ExternalLink } from 'lucide-react';
import type { SubmarketProfile } from '../model/submarketProfile';

export function hasSubmarketProfileContent(profile: SubmarketProfile | null): boolean {
  return Boolean(profile && (profile.headline || profile.overview || profile.industries || profile.transport ||
    profile.demographics.length || profile.policies.length || profile.insights.length));
}

const textSections = [['overview', '区域定位'], ['industries', '产业及办公需求'], ['transport', '交通与配套']] as const;

function SourceLink({ href, label }: { href: string; label: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="submarket-link-action">
    {label} <ExternalLink size={13} aria-hidden="true" />
  </a>;
}

export function SubmarketResearchProfile({ profile, state, onRetry }: {
  profile: SubmarketProfile | null;
  state: 'loading' | 'error' | 'ready';
  onRetry?: () => void;
}) {
  const hasBody = profile && (textSections.some(([id]) => profile[id]) || profile.demographics.length || profile.policies.length || profile.insights.length);
  return <section className="submarket-research-chapter submarket-profile" aria-labelledby="submarket-profile-heading">
    <h3 id="submarket-profile-heading">区域画像</h3>
    {state === 'loading' ? <p role="status">正在读取区域画像…</p>
      : state === 'error' ? <div className="submarket-read-status"><p role="status">区域画像暂不可用。</p>
        {onRetry ? <button type="button" className="submarket-quiet-action" onClick={onRetry}>重试区域画像</button> : null}
      </div>
        : !profile || !hasBody ? <p className="submarket-profile-meta">{profile?.headline ? '已发布区域定位见标题下方，暂无其他区域资料。' : '暂无已发布的区域画像。'}</p>
          : <div className="submarket-profile-groups">
            {textSections.map(([id, label]) => profile[id] ? <section key={id} className="submarket-profile-group">
              <h4>{label}</h4><p className="submarket-profile-copy">{profile[id]}</p>
            </section> : null)}
            {profile.demographics.length ? <section className="submarket-profile-group">
              <h4>人口与就业参考</h4>
              <dl className="submarket-profile-facts">
                {profile.demographics.map(fact => <div key={JSON.stringify(fact)}>
                  <dt>{fact.label}</dt><dd><strong>{fact.value}</strong> {fact.unit}</dd>
                  <dd className="submarket-profile-meta">{fact.scope} · {fact.asOf}</dd>
                  <dd><SourceLink href={fact.sourceUrl} label="数据来源" /></dd>
                </div>)}
              </dl>
            </section> : null}
            {profile.policies.length ? <section className="submarket-profile-group">
              <h4>政策与规划</h4>
              <ul className="submarket-profile-records">
                {profile.policies.map(item => <li key={JSON.stringify(item)}>
                  <strong>{item.title}</strong>
                  <p className="submarket-profile-meta">{item.issuer} · {item.asOf}</p>
                  <p className="submarket-profile-copy">{item.summary}</p>
                  <p>适用范围：{item.applicability}</p>
                  <SourceLink href={item.sourceUrl} label="政策原文" />
                </li>)}
              </ul>
            </section> : null}
            {profile.insights.length ? <section className="submarket-profile-group">
              <h4>市场观察</h4>
              <ul className="submarket-profile-records">
                {profile.insights.map(item => <li key={JSON.stringify(item)}>
                  <strong>{item.title}</strong><p className="submarket-profile-copy">{item.body}</p>
                  <p className="submarket-profile-meta">{item.author} · {item.asOf}</p>
                </li>)}
              </ul>
            </section> : null}
          </div>}
  </section>;
}
