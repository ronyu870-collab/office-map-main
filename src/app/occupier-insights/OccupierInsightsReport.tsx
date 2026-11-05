'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react';
import { useAppSession } from '@/src/components/SessionProvider';
import { COLLIERS_LOGO_DATA_URI } from '@/src/constants/brandAssets';
import { mountReportNavigation } from './reportNavigation';
import { charts, chapters, productivity, futureWorkspace, ecosystem, industryProfiles, assetServices, portfolioReasons, portfolioOffer, costLayers, riskOffer, employeePriorities, workplaceOffer, greenBenefits, greenEvidence, marketQuestions, reviewAreas, scenarios, workflow, conclusions, type ChartKey, type SurveyChart } from './reportContent';
import styles from './report.module.css';

function Background({ src, eager = false }: { src: string; eager?: boolean }) {
  return <Image src={src} alt="" fill sizes="100vw" className={styles.background} unoptimized loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} aria-hidden="true" />;
}
function Chart({ name, variant = 'bars' }: { name: ChartKey; variant?: 'bars' | 'compact' | 'tiles' | 'columns' }) {
  const chart: SurveyChart = charts[name];
  const ceiling = chart.ceiling || 100;
  const maximum = Math.max(...chart.items.map(([, value]) => value));
  return <figure className={styles.chart} data-chart={name} data-variant={variant} data-animate-chart>
    <figcaption id={`chart-${name}`}>{chart.title}</figcaption>
    {variant === 'columns' && <p className={styles.sourceNote}>样本比例 · 各条形满格为 100%</p>}
    {variant !== 'tiles' && variant !== 'columns' && <div className={styles.chartScale} aria-hidden="true"><span>0</span><span>{ceiling}%</span></div>}
    <ol aria-labelledby={`chart-${name}`}>
      {chart.items.map(([label, value], index) => <li key={label} data-observation data-leading={value === maximum ? 'true' : undefined} style={{ '--bar-size': `${value / ceiling * 100}%`, '--order': index, '--portion': `${value}%` } as CSSProperties}>
        <span className={styles.chartLabel}>{label}</span>
        <strong className={styles.chartValue}>{value.toFixed(1)}<small>%</small></strong>
        <span className={styles.barTrack} aria-hidden="true"><span data-bar /></span>
      </li>)}
    </ol>
    <p className={styles.sourceNote}>会议资料 · 图 {String(chart.photo).padStart(2, '0')} · 样本比例{chart.independent ? '；各项独立列示，不作合计' : ''}</p>
  </figure>;
}
function Heading({ number, label, title, children }: { number: string; label: string; title: ReactNode; children?: ReactNode }) {
  return <div className={styles.sectionHeading}><p className={styles.eyebrow}><span>{number}</span>{label}</p><h2>{title}</h2>{children && <p className={styles.lead}>{children}</p>}</div>;
}
function Tokens({ items }: { items: readonly string[] }) {
  return <ul className={styles.tokens}>{items.map(item => <li key={item}>{item}</li>)}</ul>;
}
function Analysis({ children }: { children: ReactNode }) {
  return <div className={styles.analysis}><span>应用分析</span><p>{children}</p></div>;
}

export function OccupierInsightsReport() {
  const { status, session } = useAppSession();
  const canNavigateInternally = status === 'authenticated' && session !== null;
  const reportRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (reportRef.current) return mountReportNavigation(reportRef.current); }, []);

  return <div className={styles.report} ref={reportRef}>
    <a className={styles.skipLink} href="#overview">跳至研究正文</a>
    <header className={styles.masthead} data-report-header>
      <a href="#report-top" className={styles.brand} aria-label="回到报告开头"><Image src={COLLIERS_LOGO_DATA_URI} alt="Colliers 高力国际" width={592} height={337} unoptimized className={styles.logo} /></a>
      <nav aria-label="报告章节" className={styles.chapters}>{chapters.map(([id, label]) => <a href={`#${id}`} key={id} data-chapter-link={id}>{label}</a>)}</nav>
      {canNavigateInternally ? <Link href="/" className={styles.back} aria-label="返回首页"><ArrowLeft size={16} aria-hidden="true" /><span>首页</span></Link> : null}
      <div className={styles.readingTrack} aria-hidden="true"><span data-reading-progress /></div>
    </header>
    <main>
      <section id="report-top" className={styles.cover} data-report-chapter="cover" aria-labelledby="report-title">
        <div className={styles.coverCopy}>
          <p className={styles.edition}>研究专题 <span>2026.11</span></p>
          <h1 id="report-title" aria-label="企业选址洞察"><span>企业选址</span><span>洞察<span className={styles.titleDot}>.</span></span></h1>
          <p className={styles.coverLine}>从租赁成本，<br />到企业竞争力。</p>
          <a className={styles.scrollCue} href="#overview"><span>向下阅读</span><ArrowDown size={22} aria-hidden="true" /></a>
        </div>
        <div className={styles.coverImage}><Background src="/occupier-insights/office-district.webp" eager /><div className={styles.coverImageShade} /><div className={styles.coverCaption} aria-hidden="true"><span>成本</span><i /><span>人才</span><i /><span>业务</span></div></div>
      </section>

      <section id="overview" className={`${styles.scene} ${styles.paper}`} data-report-chapter="overview" data-source-slide="01">
        <div className={styles.frame}>
          <Heading number="01" label="受访者画像" title={<>先看企业处在什么阶段，<br />再理解它为什么选择一处办公室。</>}>受访者来自高端写字楼需求行业，提供了经营与行业观点。行业和发展阶段，是理解企业办公策略的起点。</Heading>
          <div className={styles.sampleGrid}>
            <Chart name="industries" variant="compact" />
            <div><Chart name="stages" variant="tiles" /><div className={styles.editorialNote}><h3>优化与整合，是这份样本的重要背景。</h3><p>初期增长阶段关注快速扩张，组织架构与商业模式仍在构建和完善；扩张阶段关注员工增长和业务覆盖；优化阶段聚焦增长效率与质量；整合阶段强调成本控制与业务组合调整；转型或重组阶段则面临新的组织安排。</p><p>这些比例描述的是受访群体，不是所有企业或北京租赁需求的行业分布。</p></div></div>
          </div>
        </div>
      </section>

      <section id="priorities" className={styles.scene} data-report-chapter="overview" data-source-slide="02">
        <div className={styles.frame}>
          <Heading number="02" label="增长优先事项" title={<>更大的办公室，<br />不再是唯一的增长答案。</>}>生产力、成本控制与市场整合，是受访企业更优先的经营议题。房地产决策需要支持效率与风险管理，而不只是为员工扩张准备面积。</Heading>
          <Chart name="growth" variant="columns" />
          <div className={styles.twoTextColumns}><div><h3>效率从哪里来？</h3><Tokens items={productivity} /><p>办公空间需要与流程和工具共同改变。面积只是投入之一，组织能否更顺畅地运转，才是要回答的问题。</p></div><div><h3>空间需要承接什么？</h3><Tokens items={futureWorkspace} /><p>人才、协作、智能化和体验并非四套独立要求，应当在同一办公方案中协调。</p></div></div>
          <Analysis>先写清“这次选址要解决的业务问题”，再制定面积与预算。提效、降本、整合和扩张，应该导向不同的空间配置，而不是套用同一份找楼清单。</Analysis>
        </div>
      </section>

      <section id="factors" className={`${styles.scene} ${styles.paper}`} data-report-chapter="factors" data-source-slide="03">
        <div className={`${styles.frame} ${styles.split}`}>
          <div><Heading number="03" label="选址因素" title={<>成本是起点，<br />不是全部答案。</>}>人才、客户、产业联系与政策条件共同影响区位判断。只比较租金单价，会遗漏企业实际使用空间时的差异。</Heading><div className={styles.heroMetric}><strong>86.4<small>%</small></strong><p>受访者关注成本与租金</p></div><p className={styles.bodyCopy}>历史或遗留问题也占有一定比重：既有组织安排、长期形成的业务连接或原空间约束，都需要在决策中被看见。不能把所有选择都解释成主动追求某一种区位优势。</p></div>
          <Chart name="factors" />
        </div>
      </section>

      <section id="ecosystem" className={`${styles.scene} ${styles.navy}`} data-report-chapter="factors" data-source-slide="03">
        <div className={styles.frame}>
          <div className={styles.split}><div><Heading number="04" label="产业集群" title={<>选一处地址，<br />也是选择一张关系网络。</>}>成功的办公策略要评估整个生态系统：可以连接谁、共享什么、减少哪些摩擦。</Heading><div className={styles.heroMetric}><strong>67.9<small>%</small></strong><p>匹配度“高”与“较高”合计<br /><span>39.5% ＋ 28.4%；由资料两项相加</span></p></div></div><Chart name="clusters" /></div>
          <div className={styles.ecosystemGrid}>{ecosystem.map(([name,title,text],index)=><article key={name}><span className={styles.networkNode} aria-hidden="true">0{index+1}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
          <p className={styles.lightNote}>六项生态优势来自会议资料；对应核验思路为应用分析。关系网络示意不代表真实企业连接或迁移路径。</p>
        </div>
      </section>

      <section id="industry" className={styles.scene} data-report-chapter="factors" data-source-slide="04">
        <div className={styles.frame}>
          <Heading number="05" label="行业差异" title={<>相同的一栋楼，<br />对不同行业意味着不同的价值。</>}>科技、金融与专业服务、生命科学及先进制造的选址驱动并不相同。共同的判断框架，不应抹平企业在人才、客户与技术用途上的差异。</Heading>
          <div className={styles.industryGrid}>{industryProfiles.map((item,index)=><article key={item.name}><p className={styles.industryIndex}>0{index+1}</p><p className={styles.industryName}>{item.name}</p><h3>{item.focus}</h3><Tokens items={item.drivers}/><p className={styles.industryQuestion}>{item.question}</p><p>{item.analysis}</p><div className={styles.proof}><span>应用核验</span>{item.proof}</div></article>)}</div>
        </div>
      </section>

      <section id="services" className={`${styles.scene} ${styles.paper}`} data-report-chapter="factors" data-source-slide="04">
        <div className={styles.frame}>
          <Heading number="06" label="楼宇运营" title={<>竞争从提供空间，<br />走向支持企业经营。</>}>租户需求的变化，反过来推动写字楼运营升级。七类价值，需要通过持续服务而非单次交付来实现。</Heading>
          <div className={styles.serviceList}>{assetServices.map(([title,text],index)=><article key={title}><span className={styles.listNumber}>0{index+1}</span><h3>{title}</h3><p>{text}</p><ArrowUpRight size={22} aria-hidden="true" /></article>)}</div>
          <Analysis>比较楼宇时，把“有没有”进一步问成“谁来提供、如何使用、什么时间可用、是否另收费”。七项服务方向沿用资料，上述服务解释是将方向转化为可检验问题。</Analysis>
        </div>
      </section>

      <section id="portfolio" className={styles.scene} data-report-chapter="portfolio" data-source-slide="05">
        <div className={styles.frame}>
          <div className={styles.split}><div><Heading number="07" label="办公组合" title={<>办公室可以不止一处，<br />但每一处都要有明确任务。</>}>多城市、多中心与“总部＋卫星办公室”在样本中均有出现。办公组合需要在市场进入、人才供给、人才利用率和韧性之间取得平衡。</Heading><div className={styles.portfolioDiagram} aria-hidden="true"><span>客户与市场</span><i /><b>总部</b><i /><span>人才与交付</span><small>功能关系示意 · 非地理分布</small></div></div><Chart name="portfolio" /></div>
          <div className={styles.twoTextColumns}><div><h3>分散布局的六项业务考量</h3><Tokens items={portfolioReasons}/></div><div><h3>优质资产需要提供的能力</h3><Tokens items={portfolioOffer}/></div></div>
          <Analysis>分散不等于更有效。必须同时计算跨地点协作、重复配套和管理成本；如果这些成本高于获得的人才、客户与韧性收益，多点布局就没有自动成立的理由。</Analysis>
        </div>
      </section>

      <section id="risks" className={`${styles.scene} ${styles.paper}`} data-report-chapter="portfolio" data-source-slide="06">
        <div className={styles.frame}>
          <div className={styles.split}><div><Heading number="08" label="租赁风险" title={<>不只控制成本，<br />也要保留调整余地。</>}>受访者担心高于市场水平的成本、过早过度承诺，以及业务变化时失去调整空间。充分比较、提前规划和灵活条款应一起进入决策。</Heading><div className={styles.riskStatement}><span>价格</span><i>×</i><span>承诺期限</span><i>×</i><span>调整能力</span></div><p className={styles.smallCopy}>三个相互关联的判断维度；不是风险量化公式。</p></div><Chart name="risks" /></div>
          <div className={styles.offering}><h3>对业主与投资者的启示</h3><Tokens items={riskOffer}/></div>
          <Analysis>“便宜”需要可比基准，“灵活”需要具体条款。扩租、缩租、续租和退出的条件，应分别确认触发方式、通知期限和费用，不能被一句“可以协商”替代。</Analysis>
        </div>
      </section>

      <section id="cost" className={`${styles.scene} ${styles.costScene}`} data-report-chapter="portfolio" data-source-slide="06">
        <div className={`${styles.frame} ${styles.costLayout}`}>
          <div className={styles.costSticky}><Heading number="09" label="总持有成本" title={<>看得见的租金，<br />只是成本的一层。</>}>完整的成本评估，需要覆盖从租约到经营影响的八项内容。把现金支出与经营影响分开记录，再放回同一个决策框架。</Heading><div className={styles.costModel} aria-hidden="true"><span data-cost-layer="0">租约成本</span><span data-cost-layer="1">迁入投入</span><span data-cost-layer="2">经营影响</span></div><p className={styles.smallCopy}>随正文推进，逐层审视。三层归类及核验问题为应用分析。</p></div>
          <div className={styles.costSteps}>{costLayers.map((layer,index)=><article key={layer.title} data-cost-step={index}><p className={styles.eyebrow}>0{index+1} · {layer.subtitle}</p><h3>{layer.title}</h3><dl>{layer.items.map(([title,text])=><div key={title}><dt>{title}</dt><dd>{text}</dd></div>)}</dl></article>)}</div>
        </div>
        <div className={styles.frame}><Analysis>可计量支出用一致期间、面积定义和费用范围比较；通勤、生产力和灵活性单独评估。未经测算，不把“人才价值”随意折算成金额，也不把押金、可退回款项与最终费用混为一谈。</Analysis></div>
      </section>

      <section id="workplace" className={`${styles.scene} ${styles.paper}`} data-report-chapter="workplace" data-source-slide="07">
        <div className={styles.frame}>
          <div className={styles.split}><div><Heading number="10" label="工作场所与人才" title={<>满足基本需求，<br />不等于形成竞争优势。</>}>多数受访者认为，现有办公环境满足基本需求，但缺少突出亮点。混合办公仍处于谨慎、选择性的阶段；办公室依然重要，设计重点则转向协作、文化、员工体验和生产力。</Heading><div className={styles.heroMetric}><strong>61.7<small>%</small></strong><p>认为办公环境“满足基本需求但无突出亮点”</p></div></div><Chart name="workplace" /></div>
          <div className={styles.twoTextColumns}><div><h3>年轻员工更加重视</h3><Tokens items={employeePriorities}/></div><div><h3>资产可以形成的差异化</h3><Tokens items={workplaceOffer}/></div></div>
        </div>
      </section>

      <section id="experience" className={styles.experience} data-report-chapter="workplace">
        <Background src="/occupier-insights/office-interior.webp"/><div className={styles.experienceShade}/>
        <div className={styles.experienceContent}><p className={styles.eyebrow}>11 · 应用分析</p><h2>不要只参观办公室。<br />试着在里面工作一次。</h2><div className={styles.experienceChecks}><article><h3>一次真实通勤</h3><p>在工作日到访，记录换乘、步行与最后一段路，而不是只看地图直线距离。</p></article><article><h3>一场真实协作</h3><p>模拟会议、访客接待和跨团队讨论，确认共享设施是否真正可用。</p></article><article><h3>一段专注工作</h3><p>检查噪声、采光、安静工位和网络条件，避免只按大堂和样板间作判断。</p></article></div></div>
      </section>

      <section id="sustainability" className={`${styles.scene} ${styles.sage}`} data-report-chapter="workplace" data-source-slide="08">
        <div className={styles.frame}>
          <div className={styles.split}><div><Heading number="12" label="可持续发展" title={<>绿色的价值，<br />要在日常运营中兑现。</>}>可持续发展的关注点，正从标签转向成本、运营效率与建筑的实际表现。它正从差异化亮点走向基础门槛，也成为成本管理、ESG 落实与长期风险控制的组成部分。</Heading><Tokens items={greenBenefits}/></div><Chart name="sustainability" /></div>
          <h3 className={styles.subheading}>把五项资产特征，转成可核验的证据。</h3>
          <div className={styles.evidenceList}>{greenEvidence.map(([title,text],index)=><article key={title}><span>0{index+1}</span><div><h4>{title}</h4><p>{text}</p></div></article>)}</div>
          <p className={styles.sourceNote}>资产特征沿用资料；核验问题为应用分析。“走向基础门槛”是资料的趋势判断，不表示所有租户已有相同要求。</p>
        </div>
      </section>

      <section id="advisory" className={styles.scene} data-report-chapter="advisory" data-source-slide="09">
        <div className={styles.frame}>
          <div className={styles.split}><div><Heading number="13" label="战略决策" title={<>好的选址建议，<br />不止是一张房源清单。</>}>高层主导办公决策，顾问则以市场洞察、风险控制、执行与综合解决方案能力参与其中。房地产咨询由交易支持走向战略合作。</Heading><p className={styles.bodyCopy}>看懂租金、供应与业主策略，是理解机会的前提；把机会转化为可执行的商业条款和交付计划，才完成了从信息到决策的过程。</p></div><Chart name="advisory" /></div>
          <h3 className={styles.subheading}>六类信息，构成市场判断的基础。</h3><div className={styles.marketGrid}>{marketQuestions.map(([title,text])=><article key={title}><h4>{title}</h4><p>{text}</p></article>)}</div>
          <p className={styles.sourceNote}>六类信息沿用资料，比较口径为应用分析；本专题不提供未经核验的北京市场时点数据。</p>
        </div>
      </section>

      <section id="readiness" className={`${styles.scene} ${styles.paper}`} data-report-chapter="advisory" data-source-slide="10">
        <div className={styles.frame}>
          <div className={styles.split}><div><Heading number="14" label="战略准备" title={<>对现状有信心，<br />仍然可以保留优化空间。</>}>多数受访企业对当前办公策略持积极态度，但信心与改进空间可以同时存在。对成本、灵活性、场所质量、可持续性和组合一致性的审视，不应只发生在租约到期前。</Heading><div className={styles.heroMetric}><strong>66.7<small>%</small></strong><p>认为现有策略支持发展，但仍有改进空间</p></div></div><Chart name="readiness" /></div>
          <div className={styles.reviewGrid}>{reviewAreas.map(([title,text])=><article key={title}><h3>{title}</h3><p>{text}</p></article>)}</div>
          <p className={styles.sourceNote}>六个优化领域沿用资料，复盘问题为应用分析。</p>
        </div>
      </section>

      <section id="scenarios" className={styles.scene} data-report-chapter="advisory">
        <div className={styles.frame}>
          <Heading number="15" label="应用分析 · 方案比较" title={<>不是寻找唯一最好的楼，<br />而是选择最适合当下的方案。</>}>同一组业务条件下，同时审视续租、整体搬迁与分点办公。下面是比较框架，不是调研结论或预设排名。</Heading>
          <div className={styles.scenarioGrid}>{scenarios.map((item,index)=><article key={item.name}><span className={styles.scenarioIndex}>0{index+1}</span><h3>{item.name}</h3><dl><div><dt>适用前提</dt><dd>{item.case}</dd></div><div><dt>潜在价值</dt><dd>{item.benefit}</dd></div><div><dt>需要权衡</dt><dd>{item.risk}</dd></div><div><dt>决策证据</dt><dd>{item.evidence}</dd></div></dl></article>)}</div>
        </div>
      </section>

      <section id="checklist" className={`${styles.scene} ${styles.navy}`} data-report-chapter="advisory">
        <div className={styles.frame}>
          <Heading number="16" label="应用分析 · 决策落地" title={<>先对齐问题，<br />再把每一步判断留下依据。</>}>让业务、人力、财务与行政使用同一组条件；从需求、比较到核验和复盘，形成可以解释、可以交接的选址过程。</Heading>
          <div className={styles.workflow}>{workflow.map(([title,text,output],index)=><article key={title}><span className={styles.workflowNumber}>0{index+1}</span><div><h3>{title}</h3><p>{text}</p><div className={styles.output}><span>形成什么</span>{output}</div></div></article>)}</div>
          {canNavigateInternally ? <Link className={styles.mapLink} href="/map">打开北京办公楼市场地图<ArrowUpRight size={20} aria-hidden="true" /></Link> : null}
        </div>
      </section>

      <section id="conclusions" className={`${styles.scene} ${styles.paper}`} data-report-chapter="conclusions" data-source-slide="11">
        <div className={styles.frame}>
          <Heading number="17" label="核心结论" title={<>重新定义办公价值。</>}>七个变化，共同指向办公价值的重新定义。选址从一项租赁交易，走向与企业经营相连的持续决策。</Heading>
          <div className={styles.conclusions}>{conclusions.map(([title,text],index)=><article key={title}><span>0{index+1}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
          <div className={styles.closing}><p>让空间服务业务。<br /><strong>让选择保留未来。</strong></p><a href="#report-top">回到开头<ArrowRight size={18} aria-hidden="true" /></a></div>
        </div>
      </section>
    </main>
    <footer id="sources" className={styles.sources} data-report-chapter="conclusions">
      <div className={styles.frame}><h2>资料与口径</h2><p>本专题根据用户提供的 11 张会议资料照片重编。图号按“受访者画像—增长目标—区位生态—行业演进—办公布局—租赁风险—工作场所—可持续发展—咨询价值—战略准备—要点总结”的顺序对应。图表保留资料中的 11 组图表、62 个比例值；不将其表述为本平台自行开展的调查。</p><p>照片未完整披露样本量、调查时间、抽样方式与题目设置，因此比例仅反映资料所列受访样本，不代表北京企业的实际迁移、成交或未来供应，也不据此推断统计显著性。原始数值保留一位小数，不为凑足 100% 而调整；独立列示的各项不作合计。</p><p>标注“应用分析”“应用核验”的内容，是基于资料形成的决策框架与核验建议；不属于新增调研发现。67.9% 为 39.5% 与 28.4% 之和。场景图片与关系图用于视觉表达，不作为真实项目、地理分布或企业联系的证据。</p></div>
    </footer>
  </div>;
}
