'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ArrowDownRight, ArrowLeft, ArrowRight } from 'lucide-react';
import { useAppSession } from '@/src/components/SessionProvider';
import styles from './report.module.css';

const sourceUrl = 'https://cw-prod-apacgws-a-cd.cushwake.com/en/greater-china/insights/chinese-mainland-office-occupier-strategy-report';

const locationFactors = [
  ['成本与租金', 86.4],
  ['靠近客户与合作伙伴', 69.1],
  ['人才可得性与员工偏好', 60.5],
  ['激励措施与政策支持', 54.3],
] as const;

const industries = [
  {
    name: '科技与互联网',
    question: '人才在哪里，团队怎么协作？',
    check: '画出核心岗位的通勤范围，实测地铁换乘和步行。核实邻近研发机构、合作企业，以及空间扩容的可行性。',
  },
  {
    name: '金融与专业服务',
    question: '客户到访和日常办公是否便利？',
    check: '核对客户往来路线、接待条件、楼宇形象及对外会议空间。将商务区位的价值与实际租期成本一起比较。',
  },
  {
    name: '生命科学与先进制造',
    question: '办公是否能接上科研和供应链？',
    check: '先分清纯办公与研发用途，再核实专用设施、政策适用条件、上下游伙伴与科研资源。',
  },
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

function ReportImage({ cover = false }: { cover?: boolean }) {
  return (
    <figure className={styles.photo}>
      <Image
        src={cover ? '/occupier-insights/office-district.webp' : '/occupier-insights/office-interior.webp'}
        width={cover ? 1440 : 1120}
        height={cover ? 960 : 747}
        alt={cover ? '透过办公大堂玻璃望向商务街区与步行广场' : '有共享长桌和独立房间的办公空间'}
        className={styles.image}
        unoptimized
        loading={cover ? 'eager' : 'lazy'}
        fetchPriority={cover ? 'high' : 'auto'}
      />
      <figcaption>AI 生成示意 · {cover ? '商务街区' : '办公空间'}</figcaption>
    </figure>
  );
}

export function OccupierInsightsReport() {
  const router = useRouter();
  const { status } = useAppSession();
  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [router, status]);

  if (status !== 'authenticated') {
    return <main className={styles.loading} role="status">{status === 'loading' ? '正在打开企业选址洞察…' : '正在前往登录…'}</main>;
  }

  return (
    <div className={styles.report}>
      <header className={styles.masthead}>
        <div className={styles.frame}>
          <Link href="/" className={styles.back}><ArrowLeft size={16} aria-hidden="true" /> 返回首页</Link>
          <span>北京办公楼市场数据平台</span>
        </div>
      </header>
      <main className={styles.frame} id="report-top">
        <section className={styles.hero} aria-labelledby="report-title">
          <div className={styles.heroCopy}>
            <p className={styles.kicker}>研究专题 · 2026 年 11 月</p>
            <h1 id="report-title">企业选址洞察</h1>
            <p className={styles.deck}>企业在续租、搬迁或设立新办公点时，怎么在成本、人才和业务需求之间做取舍？</p>
            <p className={styles.muted}>基于戴德梁行中国大陆企业租户调研，附北京看楼核对清单。</p>
            <a className={styles.heroLink} href="#factors">阅读调研发现 <ArrowDownRight size={16} aria-hidden="true" /></a>
          </div>
          <ReportImage cover />
        </section>

        <nav className={styles.chapters} aria-label="报告章节">
          <a href="#factors">选址因素</a>
          <a href="#industry">行业差异</a>
          <a href="#checklist">看楼清单</a>
          <a href="#sources">来源与口径</a>
        </nav>

        <section id="factors" className={styles.section} aria-labelledby="factors-title">
          <p className={styles.kicker}>01 · 调研发现</p>
          <h2 id="factors-title">成本排在首位，区位还要看人和业务</h2>
          <div className={styles.evidence}>
            <div className={styles.textBlock}>
              <p>成本与租金是受访者最常提到的因素。其次是客户与合作伙伴的距离，以及人才是否容易获得。约 67.9% 的受访者认为，现有办公地点与相关产业集群完全或大体匹配。</p>
              <p>比较两个区位时，可以先算清租期内的开支，再用通勤实测和客户到访路线验证差异。</p>
            </div>
            <figure className={styles.chart} aria-labelledby="chart-title">
              <figcaption id="chart-title">企业选择办公地点的主要考虑因素</figcaption>
              <dl>
                {locationFactors.map(([label, value]) => (
                  <div className={styles.chartRow} key={label}>
                    <dt>{label}</dt>
                    <dd>{value.toFixed(1)}%</dd>
                    <dd aria-hidden="true" className={styles.barTrack}><span style={{ width: `${value}%` }} /></dd>
                  </div>
                ))}
              </dl>
              <p className={styles.muted}>受访企业选择比例，多选；列出前四项。<a href="#sources">查看来源</a></p>
            </figure>
          </div>
          <div className={styles.annotation}>
            <p><strong>企业为什么重新评估办公室？</strong></p>
            <p>在增长优先事项一题中，35.8% 选择提高生产力与效率，7.4% 选择快速扩大员工规模。这反映调研样本的优先事项，不代表已发生的搬迁。</p>
          </div>
        </section>

        <section id="industry" className={styles.section} aria-labelledby="industry-title">
          <p className={styles.kicker}>02 · 行业差异</p>
          <h2 id="industry-title">行业不同，看楼的问题也不同</h2>
          <p className={styles.intro}>把调研中的行业差异变成初访问题，再按企业的实际团队、业务和用途核对。</p>
          <dl className={styles.industryList}>
            {industries.map(industry => (
              <div key={industry.name} className={styles.industryRow}>
                <dt>{industry.name}</dt>
                <dd><p><strong>{industry.question}</strong></p><p>{industry.check}</p></dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="checklist" className={styles.section} aria-labelledby="checklist-title">
          <p className={styles.kicker}>03 · 北京看楼清单</p>
          <h2 id="checklist-title">用同一套条件比较续租和搬迁</h2>
          <div className={styles.checklistLayout}>
            <ol className={styles.checklist}>
              <li><strong>算全租期成本</strong><p>把租金、物业、装修、搬迁和交付缓冲期放在同一张表。明确计价面积、免租期和能耗口径。</p></li>
              <li><strong>核实扩缩租条件</strong><p>向业主确认可增减面积、续租或提前退出的约定，以及交付时间。把口头条件和书面条款分开记录。</p></li>
              <li><strong>用现场验证空间</strong><p>实测核心团队的通勤；看协作区、安静工位与网络条件。对于绿色认证和能耗，索取可核实的文件。</p></li>
            </ol>
            <ReportImage />
          </div>
          <Link className={styles.mapLink} href="/map">打开北京办公楼市场地图 <ArrowRight size={16} aria-hidden="true" /></Link>
        </section>

        <section id="sources" className={styles.section} aria-labelledby="sources-title">
          <p className={styles.kicker}>04 · 来源与口径</p>
          <h2 id="sources-title">这份调研可以说明什么</h2>
          <div className={styles.textBlock}>
            <p>数据来自戴德梁行研究部 2026 年 9 月发布的《洞见办公价值》：受访者为在中国大陆经营的企业决策者，样本覆盖多行业。选址因素与产业集群分别见原报告图 7、图 8；增长优先事项见第一章。</p>
            <p>调查反映受访者的考虑因素，不代表北京企业的实际迁移、成交或未来供应。看楼清单是根据调研整理的应用建议。两张配图均为 AI 生成示意。</p>
            <p><a href={sourceUrl} target="_blank" rel="noreferrer">查看戴德梁行原报告（新窗口）</a></p>
          </div>
          <details className={styles.notes}>
            <summary>查看 11 张现场照片的内容提要</summary>
            <ol>
              {fieldNotes.map(([name, takeaway]) => <li key={name}><strong>{name}</strong><p>{takeaway}</p></li>)}
            </ol>
          </details>
        </section>
        <footer className={styles.footer}><Link href="/">返回首页</Link><a href="#report-top">回到报告开头</a></footer>
      </main>
    </div>
  );
}
