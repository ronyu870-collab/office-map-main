'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react';
import { useAppSession } from '@/src/components/SessionProvider';
import { COLLIERS_LOGO_DATA_URI } from '@/src/constants/brandAssets';
import { mountReportNavigation } from './reportNavigation';
import styles from './report.module.css';

const sourceUrl = 'https://cw-prod-apacgws-a-cd.cushwake.com/en/greater-china/insights/chinese-mainland-office-occupier-strategy-report';
const chapters = [['factors', '选址因素'], ['industry', '行业差异'], ['checklist', '看楼清单'], ['sources', '来源与口径']] as const;
const locationFactors = [
  ['成本与租金', 86.4],
  ['靠近客户与合作伙伴', 69.1],
  ['人才可得性与员工偏好', 60.5],
  ['激励措施与政策支持', 54.3],
] as const;
const industries = [
  { name: '科技与互联网', question: '人才在哪里，团队怎么协作？', check: '画出核心岗位的通勤范围，实测地铁换乘和步行。核实邻近研发机构、合作企业，以及空间扩容的可行性。', focus: '人才 · 协作 · 扩容' },
  { name: '金融与专业服务', question: '客户到访和日常办公是否便利？', check: '核对客户往来路线、接待条件、楼宇形象及对外会议空间。将商务区位的价值与实际租期成本一起比较。', focus: '客户 · 接待 · 区位' },
  { name: '生命科学与先进制造', question: '办公是否能接上科研和供应链？', check: '先分清纯办公与研发用途，再核实专用设施、政策适用条件、上下游伙伴与科研资源。', focus: '用途 · 设施 · 产业协作' },
] as const;
const checklist = [
  ['算全租期成本', '把租金、物业、装修、搬迁和交付缓冲期放在同一张表。明确计价面积、免租期和能耗口径。'],
  ['核实扩缩租条件', '向业主确认可增减面积、续租或提前退出的约定，以及交付时间。把口头条件和书面条款分开记录。'],
  ['用现场验证空间', '实测核心团队的通勤；看协作区、安静工位与网络条件。对于绿色认证和能耗，索取可核实的文件。'],
] as const;
const fieldNotes = [
  ['受访者画像', '样本横跨多个行业和发展阶段，处于优化阶段的企业在受访群体中占比较高。'],
  ['增长目标', '企业更关注提高效率和控制支出，扩张面积只是实现业务目标的一种选择。'],
  ['区位与产业集群', '除租金外，客户、人才、政策和产业协作也会改变选址判断。'],
  ['行业差异', '科技、金融与专业服务、生命科学及先进制造分别看重不同的区位和配套。'],
  ['办公布局', '多中心与总部加卫星点都是调查中出现的布局，需与业务协作、人才和成本一起衡量。'],
  ['租赁风险', '把价格、租约承诺时间和未来扩缩租空间同时放进比较。'],
  ['空间与人才', '实地核对协作、专注、员工体验与数字化设施，判断空间能否支持工作。'],
  ['可持续运营', '向业主索取可核验的能耗与运营数据，再评估费用和合规要求。'],
  ['决策与顾问', '先让业务、人力、财务等各方对齐硬条件，再用市场资料和现场走访缩小范围。'],
  ['办公策略复盘', '将租赁弹性、区位、场所体验和成本定期复核，给续租或搬迁留出时间。'],
  ['总结', '用同一套条件比较续租、搬迁和分点办公，把可得信息与待核实项写清楚。'],
] as const;

function Background({ src, eager = false }: { src: string; eager?: boolean }) {
  return <Image src={src} alt="" fill sizes="100vw" className={styles.background} unoptimized loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} aria-hidden="true" />;
}

export function OccupierInsightsReport() {
  const router = useRouter();
  const { status } = useAppSession();
  const reportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [router, status]);
  useEffect(() => {
    if (status !== 'authenticated' || !reportRef.current) return;
    return mountReportNavigation(reportRef.current);
  }, [status]);

  if (status !== 'authenticated') {
    return <main className={styles.loading} role="status">{status === 'loading' ? '正在打开企业选址洞察…' : '正在前往登录…'}</main>;
  }

  return (
    <div className={styles.report} ref={reportRef}>
      <a className={styles.skipLink} href="#factors">跳至调研发现</a>
      <header className={styles.masthead} data-report-header>
        <div className={styles.brand}>
          <a href="#report-top" aria-label="回到报告开头"><Image src={COLLIERS_LOGO_DATA_URI} alt="Colliers 高力国际" width={592} height={337} className={styles.logo} unoptimized /></a>
          <span>企业选址洞察</span>
        </div>
        <nav className={styles.chapters} aria-label="报告章节">
          {chapters.map(([id, label]) => <a key={id} href={`#${id}`} data-chapter-link={id}>{label}</a>)}
        </nav>
        <Link href="/" className={styles.back}><ArrowLeft size={16} aria-hidden="true" /><span>返回首页</span></Link>
        <div className={styles.readingTrack} aria-hidden="true"><span data-reading-progress /></div>
      </header>

      <main>
        <section id="report-top" className={styles.cover} aria-labelledby="report-title" data-report-chapter="cover">
          <Background src="/occupier-insights/office-district.webp" eager />
          <div className={styles.coverShade} />
          <div className={`${styles.frame} ${styles.coverContent}`}>
            <p className={styles.coverKicker}>研究专题 · 2026 年 11 月</p>
            <h1 id="report-title">企业选址洞察</h1>
            <p className={styles.coverDeck}>在成本、人才与业务之间，<br />找到适合企业的办公选择。</p>
            <p className={styles.coverContext}>续租、搬迁，还是设立新办公点？<br />从企业租户调研出发，重新梳理选址的判断依据。</p>
            <a className={styles.coverEnter} href="#factors">向下探索 <ArrowDown size={20} aria-hidden="true" /></a>
          </div>
          <div className={`${styles.frame} ${styles.coverFoot}`}><span>第三方租户调研 · 北京看楼应用</span><span>01 — 04</span></div>
        </section>

        <section id="factors" className={`${styles.scene} ${styles.frame}`} aria-labelledby="factors-title" data-report-chapter="factors">
          <div className={styles.chapterHeading}><p>01 · 调研发现</p></div>
          <div className={styles.evidence}>
            <div className={styles.statement}>
              <h2 id="factors-title">成本排在首位，<br />区位还要看人和业务。</h2>
              <p>成本与租金是受访者最常提到的因素。其次是客户与合作伙伴的距离，以及人才是否容易获得。</p>
              <p className={styles.takeaway}>先算清租期内的开支，再用通勤实测和客户到访路线验证区位差异。</p>
            </div>
            <figure className={styles.chart} aria-labelledby="chart-title">
              <figcaption id="chart-title">企业选择办公地点的主要考虑因素</figcaption>
              <dl>
                {locationFactors.map(([label, value], index) => (
                  <div className={styles.chartRow} key={label} data-leading={index === 0 ? 'true' : undefined}>
                    <dt>{label}</dt><dd className={styles.chartValue}>{value.toFixed(1)}<span>%</span></dd>
                    <dd className={styles.barTrack} aria-hidden="true"><span style={{ width: `${value}%` }} /></dd>
                  </div>
                ))}
              </dl>
              <p className={styles.sourceNote}>中国大陆受访企业 · 多选题 · 前四项<br />来源：戴德梁行《洞见办公价值》，2026 年 9 月，图 7。</p>
            </figure>
          </div>
          <div className={styles.sceneFoot}><span>考虑因素不等于实际搬迁需求</span><a href="#priorities">再看增长目标与产业联系 <ArrowDown size={16} aria-hidden="true" /></a></div>
        </section>

        <section id="priorities" className={styles.priorities} aria-labelledby="priorities-title" data-report-chapter="factors">
          <div className={`${styles.frame} ${styles.prioritiesLayout}`}>
            <div className={styles.prioritiesCopy}>
              <p className={styles.kicker}>01 · 调研发现</p>
              <h2 id="priorities-title">重新评估办公室，<br />先看企业的优先事项。</h2>
              <p className={styles.intro}>在增长优先事项中，提高效率与扩大团队，是两种不同的选择。</p>
              <dl className={styles.priorityNumbers}>
                <div><dt>提高生产力与效率</dt><dd>35.8<span>%</span></dd></div>
                <div><dt>快速扩大员工规模</dt><dd>7.4<span>%</span></dd></div>
              </dl>
              <p className={styles.sourceNote}>中国大陆受访企业的增长优先事项；仅展示上述两项，不代表已发生的搬迁。<br />来源：《洞见办公价值》，第一章。</p>
            </div>
            <div className={styles.clusterVisual}>
              <Background src="/occupier-insights/office-skyline.webp" />
              <div className={styles.clusterShade} />
              <div className={styles.clusterCopy}>
                <p>办公地点与产业集群</p>
                <p className={styles.clusterValue}>67.9<span>%</span></p>
                <p>受访者认为现有办公地点<br />与相关产业集群完全或大体匹配。</p>
                <p className={styles.clusterSource}>中国大陆调研样本 · 原报告图 8</p>
              </div>
            </div>
          </div>
        </section>

        <section id="industry" className={`${styles.scene} ${styles.frame}`} aria-labelledby="industry-title" data-report-chapter="industry">
          <div className={styles.chapterHeading}><p>02 · 行业差异</p></div>
          <div className={styles.industryHeading}>
            <h2 id="industry-title">行业不同，<br />看楼的问题也不同。</h2>
            <p>把调研中的行业差异变成初访问题，<br />再按企业的实际团队、业务和用途核对。</p>
          </div>
          <div className={styles.industryGrid}>
            {industries.map(industry => (
              <article key={industry.name} className={styles.industryColumn}>
                <p className={styles.industryName}>{industry.name}</p>
                <h3>{industry.question}</h3>
                <p>{industry.check}</p>
                <p className={styles.industryFocus}>{industry.focus}</p>
              </article>
            ))}
          </div>
          <div className={styles.sceneFoot}><span>行业关注点用于提出问题，不替代项目核验</span><a href="#checklist">进入北京看楼清单 <ArrowDown size={16} aria-hidden="true" /></a></div>
        </section>

        <section id="checklist" className={styles.checklistScene} aria-labelledby="checklist-title" data-report-chapter="checklist">
          <Background src="/occupier-insights/office-interior.webp" />
          <div className={styles.checklistShade} />
          <div className={`${styles.frame} ${styles.checklistContent}`}>
            <div className={styles.checklistPaper}>
              <p className={styles.kicker}>03 · 北京看楼清单</p>
              <h2 id="checklist-title">用同一套条件，<br />比较续租和搬迁。</h2>
              <ol className={styles.checklist}>
                {checklist.map(([title, body], index) => <li key={title}><span className={styles.step} aria-hidden="true">0{index + 1}</span><div><h3>{title}</h3><p>{body}</p></div></li>)}
              </ol>
              <Link className={styles.mapLink} href="/map">打开北京办公楼市场地图 <ArrowRight size={18} aria-hidden="true" /></Link>
            </div>
          </div>
        </section>

        <section id="sources" className={`${styles.sources} ${styles.frame}`} aria-labelledby="sources-title" data-report-chapter="sources">
          <div className={styles.chapterHeading}><p>04 · 来源与口径</p></div>
          <h2 id="sources-title">这份调研可以说明什么</h2>
          <div className={styles.sourceColumns}>
            <div><h3>研究依据</h3><p>数据来自戴德梁行研究部 2026 年 9 月发布的《洞见办公价值》：受访者为在中国大陆经营的企业决策者，样本覆盖多行业。</p><p>选址因素与产业集群分别见原报告图 7、图 8；增长优先事项见第一章。</p><a className={styles.sourceLink} href={sourceUrl} target="_blank" rel="noopener noreferrer">查看戴德梁行原报告（新窗口）<ArrowUpRight size={18} aria-hidden="true" /></a></div>
            <div><h3>应用边界</h3><p>调查反映受访者的考虑因素，不代表北京企业的实际迁移、成交或未来供应。</p><p>行业初访问题与北京看楼清单，是根据调研整理的应用建议。实际选址仍需结合企业条件、市场资料与现场走访核实。</p></div>
          </div>
          <div className={styles.notes}>
            <h3>11 张现场照片的内容提要</h3>
            <ol>{fieldNotes.map(([name, takeaway], index) => <li key={name}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><h4>{name}</h4><p>{takeaway}</p></div></li>)}</ol>
          </div>
          <footer className={styles.footer}><Link href="/"><ArrowLeft size={16} aria-hidden="true" />返回首页</Link><span>企业选址洞察 · 2026 年 11 月</span><a href="#report-top">回到报告开头 <ArrowUpRight size={16} aria-hidden="true" /></a></footer>
        </section>
      </main>
    </div>
  );
}
