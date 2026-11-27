import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { photoSummaries, type BuildingPhotoSummary } from '@/src/lib/building-photos/model';
import { bindBuildingPhotoGallery, buildPhotoGallery, buildPhotoTrigger } from '@/src/services/map/buildingPhotoGallery';
import { hasMarketCoordinates, normalizeMapSubmarket, officeGrade } from '../model/marketIdentity';
import type { MarketBuilding } from '../model/marketStatistics';
import { latestFormalMetric, quarterKey } from '../model/quarterlyFacts';
import { marketResearchArrangement, researchCatalogReferences, type ResearchProjectReference } from '../model/submarketResearchArrangement';
import { mapOptionalNumber } from '../model/vacancyMetrics';
import { formalAssetMetric, latestAssetQuarter, RESEARCH_PRODUCTS } from '../model/marketAssetAnalytics';
import { formalQuarterRentEligible, formalQuarterVacancyEligible } from '@/src/lib/marketSamplePolicy';
import { leedDisplayValue } from '@/src/lib/leed-display';
import { MarketAssetAnalytics } from './MarketAssetAnalytics';
import { RepresentativeBrochureMatrix } from './RepresentativeBrochureMatrix';
import type { ResearchMarketType } from '../model/submarketResearchPresentation';
import styles from './MarketAssetAnalytics.module.css';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const gradeNames = { a: '甲级', b: '乙级', park: '产业园', other: '等级未收录' } as const;
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

type Project = {
  id: string;
  name: string;
  grade: keyof typeof gradeNames;
  period: string;
  quarter: number | null;
  area: number;
  rent: number;
  vacancy: number;
  building: MarketBuilding & { photos?: unknown; completion_year?: string | null; leed_certification?: string | null };
};
type Example = { project: Project; role: string; reason: string; detailReason?: string };

function projectRecord(building: MarketBuilding, id: string, grade: Project['grade'], selectedQuarter: number | null = null): Project {
  const fact = (selectedQuarter !== null ? formalAssetMetric(building.metrics, selectedQuarter) : null) ?? latestFormalMetric(building.metrics);
  const area = mapOptionalNumber(fact?.total_area), vacant = mapOptionalNumber(fact?.vacant_area);
  const rate = mapOptionalNumber(fact?.vacancy_rate);
  return {
    id, name: building.name?.trim() || '未命名项目', grade, building,
    period: fact ? `${fact.record_year}Q${fact.record_quarter}` : '',
    quarter: fact ? quarterKey(fact) : null,
    area: mapOptionalNumber(fact?.total_area), rent: mapOptionalNumber(fact?.net_effective_rent),
    vacancy: formalQuarterVacancyEligible(area, vacant) ? vacant / area : rate,
  };
}

/** Keep researched IDs first and fill real product/price/scale gaps without inventing landmark labels. */
export function selectRepresentativeProjects(buildings: readonly MarketBuilding[], submarket: string, curated: readonly Example[] = [], limit = 6): Example[] {
  const target = normalizeMapSubmarket(submarket);
  if (!target) return [];
  const quarter = latestAssetQuarter(buildings, target);
  const eligible = new Map<string, Project>();
  for (const building of buildings) {
    const { id } = building;
    const grade = officeGrade(building.grade);
    if (!id || eligible.has(id) || grade === 'other' || normalizeMapSubmarket(building.submarket) !== target) continue;
    eligible.set(id, projectRecord(building, id, grade, quarter));
  }
  const candidates = [...eligible.values()];
  const compareName = (a: Project, b: Project) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id);
  // Coordinates are a presentation tie-break only. Keep every eligible asset
  // in the median and scale samples, and never discard a curated/unlocated asset.
  // Among otherwise equivalent examples, prefer one that can also be located on the map.
  const compareNavigation = (a: Project, b: Project) =>
    Number(hasMarketCoordinates(b.building)) - Number(hasMarketCoordinates(a.building)) || compareName(a, b);
  const examples: Example[] = [];
  const used = new Set<string>();
  function add(project: Project, role: string, reason: string, detailReason?: string) {
    if (used.has(project.id) || examples.length >= limit) return;
    used.add(project.id);
    examples.push({ project, role, reason, detailReason });
  }
  for (const entry of curated) {
    const project = eligible.get(entry.project.id);
    if (project) {
      const missing = RESEARCH_PRODUCTS.filter(grade => candidates.some(candidate => candidate.grade === grade)
        && !examples.some(example => example.project.grade === grade) && project.grade !== grade).length;
      if (examples.length < limit - missing) add(project, entry.role, entry.reason, entry.detailReason);
    }
  }
  for (const grade of RESEARCH_PRODUCTS) {
    const peers = candidates.filter(project => project.grade === grade);
    if (!peers.length || examples.some(example => example.project.grade === grade)) continue;
    const comparable = peers.filter(project => project.quarter === quarter && formalQuarterRentEligible(project.area, project.rent))
      .sort((a, b) => a.rent - b.rent || compareName(a, b));
    if (comparable.length >= 3) {
      const low = comparable[Math.floor((comparable.length - 1) / 2)].rent;
      const high = comparable[Math.floor(comparable.length / 2)].rent;
      const median = (low + high) / 2;
      const central = comparable.filter(project => project.rent === low || project.rent === high).sort(compareNavigation)[0];
      add(central, gradeNames[grade] + '租金参照', '同级项目租金中位区间', central.period + ' · ' + comparable.length + ' 个同级有效项目，中位数 ' + number.format(median) + ' 元/㎡/月。');
    } else {
      const project = peers.sort((a, b) => Number(b.quarter === quarter) - Number(a.quarter === quarter)
        || Number(b.area > 0) - Number(a.area > 0) || compareNavigation(a, b))[0];
      add(project, gradeNames[grade] + '项目', project.period ? '同类产品参照' : '暂无已发布季度记录');
    }
  }
  for (const grade of RESEARCH_PRODUCTS) {
    const sizes = candidates.filter(project => project.grade === grade && project.quarter === quarter && project.area > 0)
      .sort((a, b) => a.area - b.area || compareName(a, b));
    if (sizes.length < 3 || sizes[0].area === sizes.at(-1)!.area) continue;
    const index = Math.floor((sizes.length - 1) * .75);
    const candidate = sizes.slice(index).find(project => !used.has(project.id));
    if (candidate) add(candidate, '规模参照', gradeNames[grade] + '较大规模项目', candidate.period + ' · 已知面积 ' + number.format(candidate.area) + ' ㎡。');
  }
  return examples;
}

function ProjectPhotos({ id, name, photos, active }: { id: string; name: string; photos: readonly BuildingPhotoSummary[]; active: boolean }) {
  const root = React.useRef<HTMLDivElement>(null);
  const galleryId = `submarket-project-photo-${React.useId()}`;
  const markup = React.useMemo(() => ({ __html: buildPhotoTrigger(galleryId, photos.length) + buildPhotoGallery(galleryId, escapeHtml(name), photos) }), [galleryId, name, photos]);
  React.useEffect(() => {
    const element = root.current;
    if (!element || !active) return;
    let stopped = false;
    let dispose: (() => void) | null = null;
    let observer: IntersectionObserver | null = null;
    const connect = () => {
      if (dispose || stopped || !element.isConnected) return;
      observer?.disconnect();
      const label = ({ open }: { open: boolean; index: number }) => {
        const span = element.querySelector('[data-building-photo-trigger] span');
        if (span) span.textContent = open ? '收起图片' : '查看图片';
      };
      dispose = bindBuildingPhotoGallery(element, id, photos, { initial: { open: true, index: 0 }, onChange: label });
      if (dispose) label({ open: true, index: 0 });
    };
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) connect(); }, { rootMargin: '120px' });
      observer.observe(element);
    } else connect();
    return () => { stopped = true; observer?.disconnect(); dispose?.(); };
  }, [id, photos, markup, active]);
  return <div ref={root} className={"workspace-building-photos mt-2 " + styles.photo} dangerouslySetInnerHTML={markup} />;
}

export function SubmarketRepresentativeProjects({ buildings, submarket, onOpen, compact = false, curated, active = true, researchIdentity, marketType, authorizedQuarter, showAnalytics = true }: {
  buildings: readonly MarketBuilding[];
  submarket: string;
  onOpen: (id: string) => void;
  compact?: boolean;
  curated?: readonly ResearchProjectReference[];
  showAnalytics?: boolean;
  active?: boolean;
  researchIdentity?: string;
  marketType?: ResearchMarketType;
  authorizedQuarter?: number | null;
}) {
  const curatedExamples = React.useMemo((): Example[] => {
    const entries = curated?.length ? curated : researchCatalogReferences(submarket, buildings);
    const market = normalizeMapSubmarket(submarket);
    const available = new Map(buildings.filter(building => normalizeMapSubmarket(building.submarket) === market)
      .map(building => [building.id, building]));
    return entries.flatMap(entry => {
      const building = available.get(entry.buildingId);
      return building ? [{ ...entry, project: projectRecord(building, entry.buildingId, officeGrade(building.grade)) }] : [];
    });
  }, [buildings, submarket, curated]);
  const limit = Math.max(marketResearchArrangement(submarket)?.maxProjects ?? 6, Math.min(curatedExamples.length, 6));
  const examples = React.useMemo(() => selectRepresentativeProjects(buildings, submarket, curatedExamples, limit), [buildings, submarket, curatedExamples, limit]);
  const heading = React.useId();
  return (
    <section aria-labelledby={heading} className="submarket-research submarket-projects">
      <h3 id={heading} className="submarket-project-heading">代表性项目</h3>
      {!examples.length ? <p className="submarket-project-empty">当前筛选内暂无代表项目。</p> : (
        <ul className="submarket-project-grid">
          {examples.map(({ project, role, reason, detailReason }) => (
            <li key={project.id} className="submarket-project-row">
              <div className={styles.assetRow + (compact ? " " + styles.assetRowCompact : "")}>
              <div className={styles.assetText}>
              <button type="button" onClick={() => onOpen(project.id)} className="submarket-project-link">
                <span className="min-w-0 break-words">{project.name}</span><ChevronRight size={16} aria-hidden="true" className="shrink-0" />
              </button>
              <ProjectMetrics project={project} />
              <ProjectAssetMeta project={project} />
              <p className="submarket-project-reason"><span className="submarket-project-role">{role}</span>{role.includes(gradeNames[project.grade]) ? '' : ` · ${gradeNames[project.grade]}`}{compact && ['同级项目租金中位区间','同类产品参照'].includes(reason) ? null : <> · {compact ? reason : detailReason ?? reason}</>}</p>
              </div>
              <ApprovedProjectPhotos project={project} active={active} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {!compact && <>
        <RepresentativeBrochureMatrix projects={examples.map(({ project }) => ({ id: project.id, name: project.name }))} identity={researchIdentity ?? submarket} active={active} onOpen={onOpen} />
        {showAnalytics && <MarketAssetAnalytics key={submarket} buildings={buildings} submarket={submarket} onOpen={onOpen} identity={researchIdentity} active={active} marketType={marketType} authorizedQuarter={authorizedQuarter} />}
      </>}
    </section>
  );
}

function ProjectMetrics({ project }: { project: Project }) {
  const { period, rent, vacancy } = project;
  const metrics = [period];
  if (rent >= 0) metrics.push(`净有效租金 ${number.format(rent)} 元/㎡/月`);
  if (vacancy >= 0 && vacancy <= 1) metrics.push(`空置率 ${number.format(vacancy * 100)}%`);
  return metrics.length > 1 ? <p className="submarket-project-metrics">{metrics.join(' · ')}</p> : null;
}

function ProjectAssetMeta({ project }: { project: Project }) {
  const { building, area } = project;
  const completion = String(building.completion_year ?? '').trim();
  const leed = leedDisplayValue(building.leed_certification);
  const items = [area > 0 ? number.format(area) + ' ㎡' : '', completion && completion !== '未知' && completion !== '-' ? '竣工 ' + completion : '', leed !== '未提供' ? 'LEED ' + leed : ''].filter(Boolean);
  return items.length ? <div className={styles.assetMeta}>{items.map(item => <span key={item}>{item}</span>)}</div> : null;
}

function ApprovedProjectPhotos({ project, active }: { project: Project; active: boolean }) {
  const photos = React.useMemo(() => photoSummaries(project.building.photos), [project.building.photos]);
  return photos.length ? <ProjectPhotos id={project.id} name={project.name} photos={photos} active={active} /> : null;
}
