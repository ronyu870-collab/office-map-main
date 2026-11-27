import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { photoSummaries, type BuildingPhotoSummary } from '@/src/lib/building-photos/model';
import { bindBuildingPhotoGallery, buildPhotoGallery, buildPhotoTrigger } from '@/src/services/map/buildingPhotoGallery';
import { hasMarketCoordinates, normalizeMapSubmarket, officeGrade } from '../model/marketIdentity';
import type { MarketBuilding } from '../model/marketStatistics';
import { latestFormalMetric, quarterKey } from '../model/quarterlyFacts';
import type { SubmarketIntelligence } from '../model/submarketIntelligence';
import { mapOptionalNumber } from '../model/vacancyMetrics';

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
  building: MarketBuilding & { photos?: unknown };
};
type Example = { project: Project; role: string; reason: string; detailReason?: string; sourceIds?: string[] };

function projectRecord(building: MarketBuilding, id: string, grade: Project['grade']): Project {
  const fact = latestFormalMetric(building.metrics);
  return {
    id, name: building.name?.trim() || '未命名项目', grade, building,
    period: fact ? `${fact.record_year}Q${fact.record_quarter}` : '',
    quarter: fact ? quarterKey(fact) : null,
    area: mapOptionalNumber(fact?.total_area), rent: mapOptionalNumber(fact?.net_effective_rent),
    vacancy: mapOptionalNumber(fact?.vacancy_rate),
  };
}

/** Examples describe evidence in the visible set, not recommendations or deal quality. */
export function selectRepresentativeProjects(buildings: readonly MarketBuilding[], submarket: string): Example[] {
  const target = normalizeMapSubmarket(submarket);
  if (!target) return [];
  const eligible = new Map<string, Project>();
  for (const building of buildings) {
    const { id } = building;
    const grade = officeGrade(building.grade);
    if (!id || eligible.has(id) || (grade !== 'a' && grade !== 'b') ||
        normalizeMapSubmarket(building.submarket) !== target || !hasMarketCoordinates(building)) continue;
    eligible.set(id, projectRecord(building, id, grade));
  }

  const candidates = [...eligible.values()];
  const compareName = (a: Project, b: Project) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id);
  const examples: Example[] = [];
  const used = new Set<string>();
  function add(project: Project, role: string, reason: string, detailReason?: string) {
    used.add(project.id);
    examples.push({ project, role, reason, detailReason });
  }

  const sizes = candidates.filter(project => project.area > 0)
    .sort((a, b) => b.area - a.area || (b.quarter ?? 0) - (a.quarter ?? 0) || compareName(a, b));
  if (sizes.length >= 2 && sizes[0].area > sizes[sizes.length - 1].area) {
    const largest = sizes[0];
    add(largest, '规模样本', `${largest.period} 已发布面积 ${number.format(largest.area)} ㎡，为当前 ${sizes.length} 个有面积记录的可定位甲乙级项目中的最大值。`);
  }

  const gradeGroups = (['a', 'b'] as const).map(grade => candidates.filter(project => project.grade === grade));
  const comparisons = gradeGroups.flatMap(group => {
    const cohorts = new Map<number, Project[]>();
    for (const project of group) {
      if (project.quarter === null || !(project.rent >= 0)) continue;
      const peers = cohorts.get(project.quarter) ?? [];
      peers.push(project);
      cohorts.set(project.quarter, peers);
    }
    return [...cohorts.entries()].flatMap(([quarter, peers]) => {
      if (peers.length < 3) return [];
      peers.sort((a, b) => a.rent - b.rent || compareName(a, b));
      const low = peers[Math.floor((peers.length - 1) / 2)].rent;
      const high = peers[Math.floor(peers.length / 2)].rent;
      // Use a middle observation, never a cheap outlier. Prefer a distinct example where available.
      const central = peers.filter(project => project.rent === low || project.rent === high)
        .sort((a, b) => Number(used.has(a.id)) - Number(used.has(b.id)) || compareName(a, b))[0];
      return [{ central, median: low + (high - low) / 2, count: peers.length, quarter }];
    });
  }).sort((a, b) => b.quarter - a.quarter || b.count - a.count || compareName(a.central, b.central));
  if (comparisons.length) {
    const { central, median, count } = comparisons[0];
    const reference = `同季度 ${count} 个${gradeNames[central.grade]}样本的中位数为 ${number.format(median)} 元/㎡/月。`;
    const reason = `${central.period} 净有效租金 ${number.format(central.rent)} 元/㎡/月；${reference}`;
    const existing = examples.find(example => example.project.id === central.id);
    if (existing) {
      existing.role += '与同级租金参照';
      existing.detailReason = existing.reason + reference;
      existing.reason += reason;
    } else add(central, '同级租金参照', reason, reference);
  }

  for (const group of gradeGroups) {
    const project = group.filter(item => !used.has(item.id))
      .sort((a, b) => (b.quarter ?? 0) - (a.quarter ?? 0) || compareName(a, b))[0];
    if (!project) continue;
    const grade = gradeNames[project.grade];
    add(project, `${grade}样本`, !project.period ? `项目名录归为${grade}，暂无已发布季度记录。` : project.area > 0
      ? `${project.period} 已发布面积 ${number.format(project.area)} ㎡，项目名录归为${grade}。`
      : `项目名录归为${grade}，最新已发布记录为 ${project.period}。`);
  }
  return examples;
}

function ProjectPhotos({ id, name, photos }: { id: string; name: string; photos: readonly BuildingPhotoSummary[] }) {
  const root = React.useRef<HTMLDivElement>(null);
  const galleryId = `submarket-project-photo-${React.useId()}`;
  const markup = React.useMemo(() => ({ __html: buildPhotoTrigger(galleryId, photos.length) + buildPhotoGallery(galleryId, escapeHtml(name), photos) }), [galleryId, name, photos]);
  React.useEffect(() => {
    if (root.current) return bindBuildingPhotoGallery(root.current, id, photos) ?? undefined;
  }, [id, photos, markup]);
  return <div ref={root} className="workspace-building-photos mt-2" dangerouslySetInnerHTML={markup} />;
}

export function SubmarketRepresentativeProjects({ buildings, submarket, onOpen, compact = false, curated, sources }: {
  buildings: readonly MarketBuilding[];
  submarket: string;
  onOpen: (id: string) => void;
  compact?: boolean;
  curated?: SubmarketIntelligence['projects'];
  sources?: SubmarketIntelligence['sources'];
}) {
  const curatedExamples = React.useMemo((): Example[] => {
    if (!curated?.length) return [];
    const market = normalizeMapSubmarket(submarket);
    const available = new Map(buildings.filter(building => normalizeMapSubmarket(building.submarket) === market)
      .map(building => [building.id, building]));
    return curated.flatMap(entry => {
      const building = available.get(entry.buildingId);
      return building ? [{ ...entry, project: projectRecord(building, entry.buildingId, officeGrade(building.grade)) }] : [];
    });
  }, [buildings, submarket, curated]);
  const examples = React.useMemo(() => curatedExamples.length ? curatedExamples
    : selectRepresentativeProjects(buildings, submarket), [buildings, submarket, curatedExamples]);
  const heading = React.useId();
  return (
    <section aria-labelledby={heading} className="submarket-research submarket-projects">
      <h3 id={heading} className="submarket-project-heading">代表性项目</h3>
      {!examples.length ? <p className="submarket-project-empty">当前筛选内暂无代表项目。</p> : (
        <ul className="submarket-project-grid">
          {examples.map(({ project, role, reason, detailReason, sourceIds }) => (
            <li key={project.id} className="submarket-project-row">
              <button type="button" onClick={() => onOpen(project.id)} className="submarket-project-link">
                <span className="min-w-0 break-words">{project.name}</span><ChevronRight size={16} aria-hidden="true" className="shrink-0" />
              </button>
              {!compact && <ProjectMetrics project={project} />}
              <p className="submarket-project-reason"><span className="submarket-project-role">{role}</span>{role === `${gradeNames[project.grade]}样本` ? '' : ` · ${gradeNames[project.grade]}`} · {compact ? reason : detailReason ?? reason}</p>
              {!compact && sourceIds ? sources?.filter(source => sourceIds.includes(source.id)).map(source =>
                <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer" className="submarket-link-action">{source.title}</a>) : null}
              {!compact && <ApprovedProjectPhotos project={project} />}
            </li>
          ))}
        </ul>
      )}
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

function ApprovedProjectPhotos({ project }: { project: Project }) {
  const photos = React.useMemo(() => photoSummaries(project.building.photos), [project.building.photos]);
  return photos.length ? <ProjectPhotos id={project.id} name={project.name} photos={photos} /> : null;
}
