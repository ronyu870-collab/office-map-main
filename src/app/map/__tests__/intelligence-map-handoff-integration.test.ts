import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Intelligence → Map handoff contract', () => {
  it('builds the handoff from the confirmed AI result rather than raw customer text', () => {
    const workspace = source('src/components/intelligence/IntelligenceWorkspace.tsx');
    expect(workspace).toContain('createIntelligenceMapHandoff(parseResult)');
    expect(workspace).toContain('router.push(mapHandoff.href)');
    expect(workspace).not.toContain('router.push(`/map?requirement=');
  });

  it('parses the handoff at the server route boundary before mounting the authenticated map client', () => {
    const page = source('src/app/map/page.tsx');
    const gate = source('src/app/map/MapRouteGate.tsx');
    expect(page).toContain('searchParams: Promise<');
    expect(page).toContain('parseIntelligenceMapHandoff');
    expect(gate).toContain('initialIntelligenceHandoff');
    expect(gate).toContain('status !== \'authenticated\'');
  });

  it('seeds the existing filter engine and performs only one initial candidate fit for Intelligence entry', () => {
    const mapClient = source('src/app/map/MapClient.tsx');
    expect(mapClient).toContain('initialIntelligenceHandoff?.filterState ?? null');
    expect(mapClient).toContain("type: 'patch'");
    expect(mapClient).toContain('intelligenceAutoFitDoneRef');
    expect(mapClient).toContain('intelligenceCandidatesResolved');
    expect(mapClient).toContain('filterState ?? createDefaultFilterState()');
    expect(mapClient).toContain('ctrl.fitToBuildings(filtered)');
    expect(mapClient).toContain("source: 'intelligence'");
  });

  it('shows real candidate count and a return path without creating a second filter UI', () => {
    const view = source('src/app/map/components/MapWorkbenchView.tsx');
    expect(view).toContain('intelligenceContext?.candidateCount');
    expect(view).toContain('返回需求');
    expect(view).toContain('<SidebarFilter');
  });
});
