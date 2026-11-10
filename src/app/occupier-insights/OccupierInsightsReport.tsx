'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, type CSSProperties } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react';
import { useAppSession } from '@/src/components/SessionProvider';
import { mountReportNavigation } from './reportNavigation';
import {
  surveyPlots, industryDrivers, strategyPaths,
  futureCriteria, costItems, visits,
  type SurveyPlot,
} from './reportContent';
import styles from './report.module.css';

const chapters = [
  ['factors', '调查与策略'],
  ['industry', '区位与布局'],
  ['checklist', '空间与成本'],
  ['options', '决策与行动'],
] as const;

type ChartKey = keyof typeof surveyPlots;
type Chapter = 'factors' | 'industry' | 'checklist';
type ChartScene = {
  id: string; chapter: Chapter; number: string; eyebrow: string;
  title: string; first: string; second: string; takeaway: string;
  chartTitle: string; chartKey: ChartKey; note: string; tone?: 'muted' | 'skyline' | 'interior';
};
const chartScenes: ChartScene[] = [
  {
    id:'sample',chapter:'factors',number:'02',eyebrow:'受访者画像',
    title:'理解结论之前，先看是谁在回答。',
    first:'受访企业涉及金融、科技、专业服务和多个实体行业，样本并非单一类型的办公室使用者。行业构成决定了研究更适合回答哪些问题。',
    second:'金融、科技和专业服务企业构成了受访群体的重要部分，因此解读区位、人才与办公体验时，需要注意行业需求的差异。',
    takeaway:'理解受访企业的行业构成，才能把调查结论用于适合的业务场景。',
    chartTitle:'受访企业行业分布',chartKey:'sectors',
    note:'中国大陆调查样本 · 分类比例按现场照片记录，四舍五入可能不严格合计为100%。',
  },
  {
    id:'stages',chapter:'factors',number:'03',eyebrow:'发展阶段',
    title:'优化与整合，比单纯扩张更常见。',
    first:'处于优化阶段的受访企业占45.7%，整合阶段占25.9%；两类合计71.6%。在这一群体中，空间与资源重新配置比单纯追求新增面积更值得分析。',
    second:'这不表示企业停止增长。增长同样可以来自业务整合、流程优化、组织协作和更灵活的空间布局。',
    takeaway:'衡量办公室的指标，应同时覆盖成本、组织效率与未来调整空间。',
    chartTitle:'受访企业所处发展阶段',chartKey:'stages',tone:'muted',
    note:'企业对当前发展阶段的自我归类；不代表北京全部企业的发展阶段。',
  },
  {
    id:'priorities',chapter:'factors',number:'04',eyebrow:'增长优先事项',
    title:'经营优先级，正在从规模转向效率。',
    first:'提升生产力与效率占35.8%，控制成本与资本支出占28.4%，市场及业务多元化占22.2%；相比之下，快速扩员仅占7.4%。',
    second:'企业房地产决策因此不能只问还需要多少工位，更应问空间是否能降低协作摩擦、减少闲置，并支持业务结构变化。',
    takeaway:'地产策略正在从“匹配人数”演进为“服务经营目标”。',
    chartTitle:'企业增长优先级',chartKey:'priorities',
    note:'五类增长优先事项；调查回答反映偏好，不等于已实施的扩张或搬迁。',
  },
  {
    id:'location',chapter:'industry',number:'05',eyebrow:'区位决策',
    title:'成本居首，但区位是一道多目标决策题。',
    first:'成本与租金被86.4%的受访者选中；接近客户及合作伙伴为69.1%，获取人才及员工偏好为60.5%，政策支持为54.3%。',
    second:'企业实际比较的不是单一报价，而是“租金—客户连接—员工通勤—产业环境—政策支持”的组合。这些因素可能相互制约，也可能彼此强化。',
    takeaway:'区位评估需要同一口径的租期成本和真实的客户、员工及业务网络数据。',
    chartTitle:'办公选址的主要考虑因素',chartKey:'location',tone:'muted',
    note:'多选题，比例不应相加；行业调研结果不代表实际租赁成交。',
  },
  {
    id:'ecosystem',chapter:'industry',number:'06',eyebrow:'产业生态',
    title:'位置的价值，来自周围的整个生态。',
    first:'39.5%的受访者认为现有办公地点与产业集群高度匹配，另有28.4%认为匹配程度较高；两类合计67.9%。',
    second:'共享人才池、上下游协作、专业服务与政策资源，可能共同构成一个区位的价值。这些连接无法仅用单栋楼宇的租金衡量。',
    takeaway:'选址不仅要考察大楼，还要考察企业能够连接的产业与商业网络。',
    chartTitle:'办公地点与产业集群匹配程度',chartKey:'clusters',tone:'skyline',
    note:'受访者对现有办公地点的主观评价；不是实地测量的产业集群评分。',
  },
  {
    id:'portfolio',chapter:'industry',number:'08',eyebrow:'投资组合布局',
    title:'从单一总部，走向分布式办公组合。',
    first:'多中心、多城市或混合布局占33.3%，总部加卫星办公室占25.9%。企业办公布局存在多种形态，而非单一的总部模式。',
    second:'分点办公可能扩大客户覆盖与人才触达，但也会带来多场所管理成本。企业应把信息系统、岗位协作与人员流动纳入评估。',
    takeaway:'最好的布局不是办公点越多越好，而是让组织结构、业务节奏与空间供给相匹配。',
    chartTitle:'当前企业办公布局',chartKey:'portfolio',tone:'muted',
    note:'五种布局类型；分类概括来自用户提供的现场资料。',
  },
  {
    id:'checklist',chapter:'checklist',number:'09',eyebrow:'租约与经营风险',
    title:'租赁决策最怕的，并不只是价格高。',
    first:'高于市场的成本、过早锁定长期租约，以及在业务变化中失去面积弹性，是受访决策者最关注的三类风险。',
    second:'因此，应在比较租金前核实免租期、提前退出、扩缩租条件、转租限制、交付日期与未来运营成本。合同细节可能改变整体选择。',
    takeaway:'一份看似便宜的长期租约，可能因灵活性不足而产生更高经营成本。',
    chartTitle:'办公选址时最担心的风险',chartKey:'lease',
    note:'受访者对风险的关注程度；多选口径，不代表风险实际发生概率。',
  },
  {
    id:'workplace',chapter:'checklist',number:'10',eyebrow:'工作场所体验',
    title:'办公室的质量，最终体现在人与生产力上。',
    first:'61.7%的受访者认为现有办公环境满足基本需求，并形成一定优势；与此同时，部分企业认为空间的差异化仍然不足。',
    second:'好的工作空间应当将安静专注、协作交流、数字化工具、员工健康和企业文化相结合，而不只是装修升级。',
    takeaway:'看楼时不仅要看面积与朝向，还应在真实办公场景中测试空间如何被使用。',
    chartTitle:'办公环境对吸引和留存人才的支撑',chartKey:'workplace',tone:'interior',
    note:'受访者的主观判断；不应作为某栋楼宇的人才吸引力评分。',
  },
  {
    id:'sustainability',chapter:'checklist',number:'11',eyebrow:'可持续运营',
    title:'可持续发展，要转化为可衡量的商业价值。',
    first:'55.6%的受访者首先考虑通过可持续办公方案降低成本和提升效率。品牌、风险管理以及投资者预期也是重要的经营考量。',
    second:'绿色认证只是起点。企业还应核验能源费用、设备效率、实际运营表现、认证范围和相关合规资料。',
    takeaway:'不把“绿色”作为口号，而是用能耗、费用、员工体验和长期风险检验其价值。',
    chartTitle:'可持续发展对房地产决策的驱动因素',chartKey:'sustainability',tone:'muted',
    note:'各驱动因素占比来自现场演示资料，属于受访者的主观选择结果。',
  },
  {
    id:'readiness',chapter:'checklist',number:'12',eyebrow:'战略准备度',
    title:'现有空间仍有价值，但审查不能停止。',
    first:'66.7%的受访者认为当前办公策略能够支持企业发展并应对变化；但仍有企业可通过布局、租赁结构和工作体验继续优化。',
    second:'续租节点、业务重组或重大租赁承诺之前，应定期评估面积利用率、合同期限、员工需求与市场条件。',
    takeaway:'持续优化不是必须搬迁，而是让管理层能够在关键节点做出有准备的选择。',
    chartTitle:'优化现有办公空间策略的预期作用',chartKey:'readiness',
    note:'企业自评；不能据此推断未来必然扩张或将实际发生租赁交易。',
  },
  {
    id:'advisor',chapter:'checklist',number:'13',eyebrow:'研究与咨询价值',
    title:'真正有用的研究，必须能支持决策与执行。',
    first:'市场情报收集占92.6%，风险与成本控制占88.9%，执行与谈判占72.8%。这些是受访企业重视的主要房地产咨询能力。',
    second:'从租赁报价、合同条款到现场尽调和部门协调，研究应推动实际选择，而不仅停留在市场趋势展示。',
    takeaway:'顾问的价值在于把分散信息转化成可核验、可比较、可执行的方案。',
    chartTitle:'使用外部房地产咨询团队的主要原因',chartKey:'advisors',tone:'muted',
    note:'企业对专业支持需求的调查结果，不代表本平台已经提供这些服务。',
  },
];

function Background({ src, eager = false }: { src: string; eager?: boolean }) {
  return <picture className={styles.picture}>
    <source type="image/avif" srcSet={src.replace(/\.webp$/, '.avif')} />
    <Image src={src} alt="" fill sizes="100vw" className={styles.background} unoptimized loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} aria-hidden="true" />
  </picture>;
}
type PlotMode = 'bars' | 'columns' | 'dots' | 'composition' | 'portfolio';
const plotModes: Record<ChartKey, PlotMode> = {
  sectors: 'bars', stages: 'composition', priorities: 'columns', location: 'dots',
  clusters: 'composition', portfolio: 'portfolio', lease: 'bars', workplace: 'composition',
  sustainability: 'columns', readiness: 'composition', advisors: 'dots',
};
function PortfolioSketch() {
  return <svg className={styles.networkSketch} viewBox="0 0 500 108" aria-hidden="true">
    <g className={styles.networkLines} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M65 54H250" /><path d="M250 54L420 22" /><path d="M250 54L420 86" />
    </g>
    <g className={styles.networkNodes} fill="currentColor"><circle cx="65" cy="54" r="14"/><circle cx="250" cy="54" r="18"/><circle cx="420" cy="22" r="10"/><circle cx="420" cy="86" r="10"/></g>
  </svg>;
}
function DataPlot({ title, data, chartKey }: { title: string; data: SurveyPlot; chartKey: ChartKey }) {
  const mode = plotModes[chartKey];
  const total = data.reduce((sum, [,value])=>sum+value,0);
  return <figure className={styles.dataPlot} data-study data-reveal data-plot={mode}>
    <figcaption>{title}</figcaption>
    {mode === 'portfolio' && <PortfolioSketch />}
    {mode === 'composition' && <div className={styles.composition} aria-hidden="true">
      {data.map(([label,value],index)=><span key={label} style={{flex: value / total, '--series': index} as CSSProperties} />)}
    </div>}
    <dl className={styles.plotRows}>
      {data.map(([label, value], index) => <div className={styles.metricRow} key={label} data-survey-value="true"
        data-leading={index === 0 ? 'true' : undefined}
        style={{'--value': value + '%', '--column-ratio': value / 60, '--series': index, '--order': index} as CSSProperties}>
        <dt>{label}</dt><dd className={styles.value}><span>{value.toFixed(1)}</span><small>%</small></dd>
        <dd className={styles.barTrack} aria-hidden="true"><span /></dd>
      </div>)}
    </dl>
  </figure>;
}
function SurveyScene({ scene }: { scene: ChartScene }) {
  const image = scene.id === 'portfolio' ? 'office-network-panorama' : scene.id === 'workplace' ? 'office-workplace-panorama'
    : scene.id === 'sustainability' ? 'office-green-panorama' : scene.id === 'ecosystem' ? 'office-ecosystem-panorama' : null;
  return <section id={scene.id} data-report-chapter={scene.chapter} data-scene-kind={scene.id}
    aria-labelledby={scene.id + '-title'}
    className={[styles.scene, scene.tone === 'muted' ? styles.tinted : '', image ? styles.photoScene : ''].join(' ')}>
    <div className={[styles.frame,styles.storyLayout].join(' ')}>
      <div className={styles.storyText} data-reveal>
        <h2 id={scene.id + '-title'}>{scene.title}</h2>
        <p>{scene.first}</p><p>{scene.second}</p>
        <p className={styles.takeaway}>{scene.takeaway}</p>
      </div>
      <div className={styles.visual}>
        {image && <div className={styles.scenePhoto} data-reveal><Background src={'/occupier-insights/'+image+'.webp'} /></div>}
        <DataPlot title={scene.chartTitle} data={surveyPlots[scene.chartKey]} chartKey={scene.chartKey} />
      </div>
    </div>
  </section>;
}

export function OccupierInsightsReport() {
  const { status, session } = useAppSession();
  const canNavigateInternally = status === 'authenticated' && session !== null;
  const reportRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (reportRef.current) return mountReportNavigation(reportRef.current); }, []);
  return <div className={styles.report} ref={reportRef}>
    <a className={styles.skipLink} href="#factors">跳至研究内容</a>
    <header className={styles.masthead} data-report-header>
      <div className={styles.brand}><a href="#report-top" aria-label="回到报告开头"><Image src="/colliers-logo.png" alt="Colliers 高力国际" width={592} height={337} className={styles.logo} unoptimized /></a><span>企业选址洞察</span></div>
      <nav className={styles.chapters} aria-label="报告章节">
        {chapters.map(([id,label])=><a key={id} href={'#'+id} data-chapter-link={id}>{label}</a>)}
      </nav>
      {canNavigateInternally && <Link href="/" className={styles.back} aria-label="返回首页"><ArrowLeft size={16} aria-hidden="true" /><span>返回首页</span></Link>}
      <div className={styles.readingTrack} aria-hidden="true"><span data-reading-progress /></div>
    </header>
    <main>
      <section id="report-top" className={styles.cover} aria-labelledby="report-title" data-report-chapter="cover">
        <Background src="/occupier-insights/office-cover.webp" eager />
        <div className={styles.coverShade} />
        <div className={[styles.frame,styles.coverInner].join(' ')}>
          <p className={styles.coverKicker}>高力国际 · 2026 年 11 月</p>
          <h1 id="report-title">企业选址洞察</h1>
          <p className={styles.coverDeck}>从规模扩张到价值创造，<br />办公室正在承担新的使命。</p>
          <a className={styles.coverEnter} href="#factors">向下阅读 <ArrowDown size={20} aria-hidden="true" /></a>
        </div>
      </section>

      <section id="factors" className={[styles.scene,styles.leadScene].join(' ')} aria-labelledby="factors-title" data-report-chapter="factors">
        <div className={[styles.frame,styles.leadInner].join(' ')}>
          <div className={styles.leadGrid}>
            <div data-reveal>
              <h2 id="factors-title">企业选址，<br />已经不只是找一间办公室。</h2>
              <p className={styles.lead}>租金仍然重要，但企业越来越重视办公场所能否支持客户连接、人才获取、生产效率及经营韧性。市场竞争和组织方式的变化，正在重新定义选址决策。</p>
              <p className={styles.takeaway}>判断一项办公方案的价值，不应从“更大的面积”出发，而应从企业真正要解决的经营问题出发。</p>
            </div>
            <div className={styles.keyNumbers} data-reveal>
              <div><strong>86.4<small>%</small></strong><p>将租金与成本列为重要选址因素</p></div>
              <div><strong>45.7<small>%</small></strong><p>受访者处于业务优化阶段</p></div>
              <div><strong>67.9<small>%</small></strong><p>认为办公地点与产业集群匹配程度较高</p></div>
            </div>
          </div>
        </div>
      </section>

      {chartScenes.slice(0,5).map(scene=><SurveyScene key={scene.id} scene={scene} />)}

      <section id="industry" data-report-chapter="industry" className={styles.scene} aria-labelledby="industry-title">
        <div className={styles.frame}>
          <div className={styles.sectionIntro} data-reveal>
            <h2 id="industry-title">没有一种选址方案，<br />适合所有企业。</h2>
            <p>从人才密度到客户可达性，再到研发及供应链条件，不同行业存在不同的选址驱动因素。先明确行业需求，再确定看楼时必须验证的条件。</p>
          </div>
          <div className={styles.industryGrid}>
            {industryDrivers.map((sector)=><article className={styles.industryCard} key={sector.name} data-reveal>
              <h3>{sector.name}</h3>
              <p>{sector.intro}</p>
              <ul>{sector.points.map(point=><li key={point}>{point}</li>)}</ul>
              <p className={styles.validation}><strong>初访核验</strong>{sector.validate}</p>
            </article>)}
          </div>
        </div>
      </section>

      {chartScenes.slice(5).map(scene=><SurveyScene key={scene.id} scene={scene} />)}

      <section id="evolution" className={styles.scene} data-report-chapter="checklist" aria-labelledby="evolution-title">
        <div className={styles.frame}>
          <div className={styles.sectionIntro} data-reveal>
            <h2 id="evolution-title">下一代办公室，<br />需要一套新的评价标准。</h2>
            <p>随着经营优先级改变，企业期待办公空间在成本之外承担更多职责：连接产业资源、支持协作、优化员工体验，并在不确定的环境下保留调整空间。</p>
          </div>
          <div className={styles.principleGrid}>
            {futureCriteria.map(([title,body])=><article className={styles.principle} key={title} data-reveal>
              <h3>{title}</h3><p>{body}</p>
            </article>)}
          </div>
        </div>
      </section>

      <section id="options" className={[styles.scene,styles.tinted].join(' ')} data-report-chapter="options" aria-labelledby="options-title">
        <div className={styles.frame}>
          <div className={styles.sectionIntro} data-reveal>
            <h2 id="options-title">续租、搬迁或分点办公，<br />先定义问题再比较方案。</h2>
            <p>没有一种固定选择适用于所有企业。应先明确业务目标与不可妥协的条件，再把不同方案放进同一张比较表。</p>
          </div>
          <div className={styles.pathGrid}>
            {strategyPaths.map((item)=><article className={styles.pathCard} key={item.name} data-reveal>
              <h3>{item.name}</h3>
              <p className={styles.pathLead}>{item.lead}</p>
              <p><strong>适合情形</strong>{item.suitable}</p>
              <p><strong>必须核验</strong>{item.check}</p>
            </article>)}
          </div>
        </div>
      </section>

      <section id="cost" className={styles.scene} data-report-chapter="options" aria-labelledby="cost-title">
        <div className={styles.frame}>
          <div className={styles.sectionIntro} data-reveal>
            <h2 id="cost-title">比较租金之前，<br />先算清真实的占用成本。</h2>
            <p>把持续运营成本、一次性投入、租约条件和对业务的影响放在同一评价周期。方案必须使用相同的面积、时间、税费及计价口径。</p>
          </div>
          <div className={styles.costFlow} data-reveal>
            {costItems.map(([title,body])=><article key={title}>
              <h3>{title}</h3><p>{body}</p>
            </article>)}
          </div>

        </div>
      </section>

      <section id="visits" className={[styles.scene,styles.tinted].join(' ')} data-report-chapter="options" aria-labelledby="visits-title">
        <div className={styles.frame}>
          <div className={styles.sectionIntro} data-reveal>
            <h2 id="visits-title">把研究结论，<br />落到每一次实际看楼。</h2>
            <p>从业务条件到现场体验，再到合同交付，用三轮核验把研究结论转化为可执行的选择。</p>
          </div>
          <ol className={styles.visitSteps}>
            {visits.map(([title,body],index)=><li key={title} data-reveal>
              <span>{'第'+['一','二','三'][index]+'轮'}</span><h3>{title}</h3><p>{body}</p>
            </li>)}
          </ol>
          {canNavigateInternally && <Link href="/map" className={styles.mapLink}>打开北京办公楼市场地图 <ArrowRight size={18} aria-hidden="true" /></Link>}
          <footer className={styles.footer}>
            {canNavigateInternally && <Link href="/"><ArrowLeft size={16} aria-hidden="true" />返回首页</Link>}
            <a href="#report-top">回到报告开头 <ArrowUpRight size={16} aria-hidden="true" /></a>
          </footer>
        </div>
      </section>


    </main>
  </div>;
}
