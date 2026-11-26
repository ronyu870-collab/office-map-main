'use client';

import * as React from 'react';
import { ChevronRight, Pencil } from 'lucide-react';
import { observeBusinessReading } from '@/src/utils/businessReadingAudit';
import { WorkspacePanelContext, WorkspacePanelHeader } from './WorkspacePanelHeader';
import { SubmarketProfileEditor } from './SubmarketProfileEditor';
import { hasSubmarketProfileContent, SubmarketResearchProfile } from './SubmarketResearchProfile';
import { SubmarketResearchOverview, SubmarketResearchTrend, type SubmarketResearchFutureState } from './SubmarketResearchData';
import { SubmarketRepresentativeProjects } from './SubmarketRepresentativeProjects';
import { useSubmarketWorkspaceDetail } from './useSubmarketWorkspaceDetail';
import { describeQuarterlyResearchMarket, researchNumber } from '../model/submarketResearch';
import type { MarketBuilding, SubmarketSummary } from '../model/submarketOverview';
import { useMapObjectReadingState, useMapReadingScroll } from '../workspace/continuity';
import './submarket-research.css';

const sections = [
  ['overview', '市场概览'], ['trend', '行情趋势'], ['profile', '区域画像'], ['buildings', '代表项目'],
] as const;
const gradeNames = [['all', '甲乙级'], ['a', '甲级'], ['b', '乙级']] as const;
const emptyTrend = [] as const;
type Section = (typeof sections)[number][0];
type Grade = (typeof gradeNames)[number][0];
const initialReading = { section: 'overview', grade: 'all', scrollTop: 0 } as { section: Section; grade: Grade; scrollTop: number };

type Props = {
  name: string;
  summary: SubmarketSummary;
  buildings: MarketBuilding[];
  futureState: SubmarketResearchFutureState;
  futureCount: number;
  futureArea?: number | null;
  futureAreaSamples?: number;
  beijingBenchmarkBuildings?: readonly MarketBuilding[];
  researchScopeKey?: string;
  canEdit: boolean;
  suspended?: boolean;
  mapLocationNotice?: string;
  onExitGuardChange?: (guard: (() => boolean) | null) => void;
  onClose: () => void;
  onShowAll: () => void;
  onOpenBuilding: (id: string) => void;
};

export function SubmarketDetailPanel(props: Props) {
  const identity = props.researchScopeKey == null ? props.name : JSON.stringify([props.researchScopeKey, props.name]);
  return <SubmarketWorkspace key={JSON.stringify([identity, props.canEdit])} {...props} identity={identity} />;
}

function SubmarketWorkspace({
  identity, name, summary, buildings, futureState, futureCount, futureArea, futureAreaSamples, beijingBenchmarkBuildings,
  canEdit, suspended: suspendedProp = false, mapLocationNotice, onExitGuardChange, onClose, onShowAll, onOpenBuilding,
}: Props & { identity: string }) {
  const workspace = React.useContext(WorkspacePanelContext);
  const suspended = suspendedProp || workspace?.active === false;
  const expanded = workspace?.mode === 'full';
  const quick = Boolean(workspace?.compact && workspace.mode === 'compact');
  const [reading, setReading] = useMapObjectReadingState('submarkets', identity, initialReading);
  const { grade, section } = reading;
  const detail = useSubmarketWorkspaceDetail(name);
  const editing = canEdit && detail.editor != null;
  const canExit = React.useCallback(() => !detail.saving && (!editing || window.confirm('当前编辑尚未保存，确定放弃更改并离开子市场介绍吗？')), [editing, detail.saving]);
  React.useEffect(() => {
    onExitGuardChange?.(canExit);
    return () => onExitGuardChange?.(null);
  }, [canExit, onExitGuardChange]);
  const closePanel = React.useCallback(() => {
    // The parent applies the same guard to toolbar, SDK area changes and close.
    if (onExitGuardChange || canExit()) onClose();
  }, [canExit, onExitGuardChange, onClose]);

  React.useEffect(() => {
    if (suspended) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      closePanel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [suspended, closePanel]);

  const { payload, profile, trendState, retry } = detail;
  const profileReady = hasSubmarketProfileContent(profile);
  const currentSection = sections.some(([id]) => id === section) ? section : 'overview';
  const auditSection = expanded || quick ? 'overview' : currentSection;
  const auditGrade = quick ? 'all' : grade;
  const lastReading = React.useRef('');
  React.useEffect(() => {
    if (suspended) { lastReading.current = ''; return; }
    if (!payload || editing || detail.error || detail.loading) return;
    const key = JSON.stringify([name, auditSection, auditGrade]);
    if (lastReading.current === key) return;
    lastReading.current = key;
    observeBusinessReading('VIEW_SUBMARKET', 'map', { target_table: 'submarket_profiles', target_id: name,
      submarket: name, section: auditSection, grade: auditGrade, observation: 'view_displayed' }, 'submarket');
  }, [name, auditSection, auditGrade, suspended, payload, editing, detail.error, detail.loading]);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const trendHeadingRef = React.useRef<HTMLHeadingElement>(null);
  const jumpToTrend = React.useRef(false);
  const surface = editing ? 'editor' : quick ? 'quick' : expanded ? 'expanded' : currentSection;
  // Store tab positions separately from compact/full layouts and from the editor.
  const resetScroll = useMapReadingScroll(scrollRef, JSON.stringify([identity, surface]), !suspended,
    surface === currentSection && section === currentSection ? reading.scrollTop : 0, 'submarketScrolls');
  const setSection = (next: Section) => setReading(previous => previous.section === next ? previous : { ...previous, section: next, scrollTop: 0 });
  React.useLayoutEffect(() => {
    if (!expanded || editing || suspended || !jumpToTrend.current) return;
    jumpToTrend.current = false;
    const heading = trendHeadingRef.current;
    const scroll = scrollRef.current;
    if (!heading || !scroll) return;
    resetScroll(scroll.scrollTop + heading.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 12);
    heading.focus({ preventScroll: true });
  }, [expanded, editing, resetScroll, suspended]);

  const allTrend = payload?.trends.all ?? emptyTrend;
  const quarter = React.useMemo(() => describeQuarterlyResearchMarket(allTrend), [allTrend]);
  const rentPeriod = quarter.rent.latest?.period;
  const vacancyPeriod = quarter.vacancy.latest?.period;
  const periodLabel = rentPeriod && rentPeriod === vacancyPeriod ? `正式行情 · ${rentPeriod}`
    : [rentPeriod && `租金 ${rentPeriod}`, vacancyPeriod && `空置率 ${vacancyPeriod}`].filter(Boolean).join(' · ');
  const layout = quick && !editing ? 'quick' : expanded ? 'expanded' : 'standard';
  const showTabs = !editing && layout === 'standard';
  const profileUnavailable = payload?.profileAvailable === false;
  const profileState = profileReady ? 'ready' : detail.loading ? 'loading' : detail.error || profileUnavailable ? 'error' : 'ready';
  const profileChapter = <SubmarketResearchProfile profile={profile} state={profileState}
    onRetry={profileState === 'error' ? retry : undefined} />;
  const focusReadingTab = React.useRef(false);
  const activeTabRef = React.useRef<HTMLButtonElement>(null);
  const openStandard = (next?: Section) => {
    if (next) setSection(next);
    focusReadingTab.current = true;
    workspace?.setMode('reading');
  };
  React.useLayoutEffect(() => {
    if (!showTabs || suspended || !focusReadingTab.current) return;
    focusReadingTab.current = false;
    activeTabRef.current?.focus({ preventScroll: true });
  }, [showTabs, suspended]);

  const trend = (full: boolean) => <section className="submarket-research-chapter" aria-labelledby="submarket-trend-heading">
    <div className="submarket-chapter-heading">
      <h3 id="submarket-trend-heading" ref={trendHeadingRef} tabIndex={-1}>租金与空置率趋势</h3>
      {workspace && !full ? <button type="button" className="submarket-quiet-action" onClick={() => {
        jumpToTrend.current = true;
        workspace.setMode('full');
      }}>展开图表</button> : null}
    </div>
    <div role="group" aria-label="楼宇等级" className="submarket-grade-selector">
      {gradeNames.map(([id, label]) => <button type="button" key={id} aria-pressed={grade === id}
        onClick={() => setReading(previous => ({ ...previous, grade: id }))}>{label}</button>)}
    </div>
    <SubmarketResearchTrend data={payload?.trends[grade] ?? emptyTrend} state={trendState}
      gradeLabel={gradeNames.find(([id]) => id === grade)?.[1] ?? '甲乙级'} onRetry={detail.error ? undefined : retry}
      showDigest={!full || grade !== 'all'} showSource={!full} />
  </section>;
  const overview = <SubmarketResearchOverview name={name} summary={summary} buildings={buildings} trendData={allTrend}
    trendState={trendState} futureState={futureState} futureCount={futureCount} futureArea={futureArea} futureAreaSamples={futureAreaSamples}
    beijingBenchmarkBuildings={beijingBenchmarkBuildings} includeTrendSource={expanded} />;
  const projects = (compact = false) => <SubmarketRepresentativeProjects buildings={buildings} submarket={name}
    onOpen={onOpenBuilding} compact={compact} />;

  return <div hidden={suspended || undefined} aria-hidden={suspended || undefined}
    className={suspended ? 'map-submarket-workspace hidden' : 'map-submarket-workspace'}>
    <section data-map-submarket-panel data-submarket-compact={quick && !editing || undefined} data-submarket-layout={layout}
      aria-labelledby="submarket-dialog-heading" className="map-submarket-workspace-panel submarket-research-panel">
      <WorkspacePanelHeader title={name} titleId="submarket-dialog-heading" onClose={closePanel} closeLabel="关闭子市场介绍"
        metadata={!editing ? <div className="submarket-header-context">
          <p className="submarket-headline">{profile?.headline || `${name}办公市场概览`}</p>
          {periodLabel && trendState !== 'error' ? <p>{periodLabel}</p> : null}
        </div> : null}
        primaryAction={!editing ? <button type="button" className="workspace-panel-primary-action" aria-label="查看全部项目" onClick={onShowAll}>全部项目</button> : null}
        actions={canEdit && payload?.profileAvailable && !editing && !detail.loading && !detail.error
          ? <button type="button" aria-label="维护资料" title="维护资料" className="workspace-icon" onClick={() => {
            detail.beginEditing();
            if (quick) workspace?.setMode('reading');
          }}><Pencil size={16} aria-hidden="true" /></button> : null} />

      {mapLocationNotice ? <p role="status" className="workspace-note">{mapLocationNotice}</p> : null}
      {showTabs ? <nav role="tablist" aria-label="子市场研究内容" className="submarket-research-tabs" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = sections.findIndex(([id]) => id === currentSection);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length;
        const target = sections[next][0];
        setSection(target);
        document.getElementById('submarket-tab-' + target)?.focus();
      }}>
        {sections.map(([id, label]) => <button type="button" role="tab" key={id} id={'submarket-tab-' + id}
          ref={currentSection === id ? activeTabRef : undefined} tabIndex={currentSection === id ? 0 : -1} aria-selected={currentSection === id}
          aria-controls="submarket-active-panel" onClick={() => setSection(id)}>{label}</button>)}
      </nav> : null}

      <div ref={scrollRef} tabIndex={0} aria-label={editing ? '编辑子市场资料' : showTabs ? undefined : '子市场研究内容'}
        role={showTabs ? 'tabpanel' : 'region'} id={showTabs ? 'submarket-active-panel' : undefined}
        aria-labelledby={showTabs ? 'submarket-tab-' + currentSection : undefined} className="workspace-scroll submarket-research-scroll">
        <div className="submarket-research-content">
          {editing && detail.editor ? <div className="submarket-editor-surface">
            <div className="submarket-chapter-heading"><h3>维护区域资料</h3>
              {workspace && !expanded ? <button type="button" className="submarket-quiet-action" onClick={() => workspace.setMode('full')}>展开编辑</button> : null}
            </div>
            <SubmarketProfileEditor name={name} value={detail.editor} saving={detail.saving} error={detail.saveError}
              onCancel={detail.cancelEditing} onSave={detail.save} />
          </div> : <>
            {!(showTabs && currentSection === 'profile' && profileState !== 'ready') && (detail.error || (detail.loading && payload)) ? <div className="submarket-read-status">
              <p role="status">{detail.loading ? '正在重新读取子市场资料…' : payload ? '刷新失败，保留上次读取的区域资料。' : '子市场资料暂不可用。'}</p>
              {!detail.loading ? <button type="button" className="submarket-quiet-action" onClick={retry}>重新加载</button> : null}
            </div> : null}
            {layout === 'quick' ? <QuickSummary summary={summary} onRead={() => openStandard()}
                onViewProjects={() => openStandard('buildings')} />
              : layout === 'expanded' ? <div className="submarket-brief">
                <section className="submarket-research-chapter submarket-brief-overview" aria-labelledby="submarket-brief-overview">
                  <h3 id="submarket-brief-overview">市场概览</h3>{overview}
                </section>
                <div className="submarket-brief-trend">{trend(true)}</div>
                <div className="submarket-brief-profile">{profileChapter}</div>
                <div className="submarket-brief-projects">{projects()}</div>
              </div> : currentSection === 'overview' ? <div className="submarket-section-flow">
                {overview}
                {payload?.trendError ? <div className="submarket-read-status"><p role="status">历史行情暂不可用</p>
                  <button type="button" className="submarket-quiet-action" disabled={detail.loading} onClick={retry}>重新加载</button></div> : null}
                {profile?.overview ? <div className="submarket-overview-profile">
                  <p>{profile.overview}</p>
                  <button type="button" className="submarket-link-action" onClick={() => setSection('profile')}>完整区域画像 <ChevronRight size={14} aria-hidden="true" /></button>
                </div> : profileUnavailable ? <div className="submarket-read-status"><p role="status">区域画像暂不可用。</p>
                  <button type="button" className="submarket-quiet-action" disabled={detail.loading} onClick={retry}>重试区域画像</button></div> : null}
                <div className="submarket-overview-actions">
                  <button type="button" className="submarket-link-action" onClick={() => setSection('trend')}>查看趋势 <ChevronRight size={14} aria-hidden="true" /></button>
                  <button type="button" className="submarket-link-action" onClick={() => setSection('buildings')}>查看项目 <ChevronRight size={14} aria-hidden="true" /></button>
                </div>
                {projects(true)}
              </div> : currentSection === 'trend' ? trend(false)
                : currentSection === 'profile' ? profileChapter : projects()}
          </>}
        </div>
      </div>
    </section>
  </div>;
}

function QuickSummary({ summary, onRead, onViewProjects }: { summary: SubmarketSummary; onRead: () => void; onViewProjects: () => void }) {
  const metric = (value: number | null, unit: string, precision = 1) => value != null && Number.isFinite(value)
    ? <>{researchNumber(value, precision)} <span>{unit}</span></> : <span>未收录</span>;
  return <section className="submarket-quick-summary" aria-label="市场核心指标">
    {/* Keep the existing sheet measurement; the extra details stay in the scroller. */}
    <div data-workspace-summary>
      <p>当前筛选 · 甲乙级存量 · 最新发布记录</p>
      <dl>
        <div><dt>平均净有效租金</dt><dd>{metric(summary.rent, '元/㎡/月')}</dd></div>
        <div><dt>平均空置率</dt><dd>{metric(summary.vacancyPct, '%')}</dd></div>
        <div><dt>甲乙级项目</dt><dd>{metric(summary.officeCount, '个', 0)}</dd></div>
      </dl>
      <button type="button" className="submarket-link-action" onClick={onRead}>阅读完整研究 <ChevronRight size={14} aria-hidden="true" /></button>
    </div>
    {summary.officeCount > 0 ? <p className="submarket-quick-fact">存量构成：甲级 {researchNumber(summary.gradeACount, 0)} 个，乙级 {researchNumber(summary.gradeBCount, 0)} 个。</p> : null}
    <button type="button" className="submarket-link-action" onClick={onViewProjects}>查看代表项目 <ChevronRight size={14} aria-hidden="true" /></button>
  </section>;
}
