import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Intelligence AI integration contract', () => {
  it('keeps DeepSeek credentials server-only and uses structured Responses API output', () => {
    const parser = source('src/lib/intelligence/deepSeekRequirementParser.ts');
    const envExample = source('.env.local.example');

    expect(parser).toContain('process.env.DEEPSEEK_API_KEY');
    expect(parser).toContain('/responses');
    expect(parser).toContain("type: 'json_schema'");
    expect(parser).toContain("reasoning: { effort: 'none' }");
    expect(parser).toContain("cache: 'no-store'");
    expect(parser).not.toContain('NEXT_PUBLIC_DEEPSEEK');
    expect(envExample).toContain('DEEPSEEK_API_KEY=sk_REPLACE_ME');
    expect(envExample).not.toContain('NEXT_PUBLIC_DEEPSEEK');
  });

  it('requires verified authentication and Intelligence Preview access through one shared server boundary', () => {
    const context = source('src/lib/intelligence/serverContext.ts');
    const parseRoute = source('src/app/api/intelligence/parse-requirement/route.ts');
    const recommendRoute = source('src/app/api/intelligence/recommend/route.ts');

    expect(context).toContain('auth.getUser(accessToken)');
    expect(context).toContain(".from('user_roles')");
    expect(context).toContain('isIntelligencePreviewEnabled(roleRow.role)');
    expect(parseRoute).toContain('requireIntelligenceAccess(request)');
    expect(recommendRoute).toContain('requireIntelligenceAccess(request)');
    expect(parseRoute).toContain('RequirementParseInputSchema.safeParse');
    expect(recommendRoute).toContain('RequirementParseInputSchema.safeParse');
    expect(recommendRoute).toContain('normalizeRequirementAgainstVocabulary');
  });

  it('awaits privacy-preserving AI audit writes before returning while keeping audit failures non-blocking', () => {
    const parseRoute = source('src/app/api/intelligence/parse-requirement/route.ts');
    const recommendRoute = source('src/app/api/intelligence/recommend/route.ts');
    const auditCoverage = source('scripts/check-audit-coverage.mjs');

    expect(parseRoute).toContain("action_type: 'AI_REQUIREMENT_PARSE'");
    expect(recommendRoute).toContain("action_type: 'AI_RECOMMENDATION'");
    expect(parseRoute).toContain('requirement_length: requirementLength');
    expect(recommendRoute).toContain('requirement_length: requirementLength');
    expect(recommendRoute).toContain('candidate_count: response.plan.candidateCount');
    expect(parseRoute).toContain('await auditAIParse(');
    expect(recommendRoute).toContain('await auditRecommendation(');
    expect(parseRoute).not.toMatch(/\bvoid\s+auditAIParse\s*\(/);
    expect(recommendRoute).not.toMatch(/\bvoid\s+auditRecommendation\s*\(/);
    expect(parseRoute).toContain('AI_REQUIREMENT_PARSE write threw');
    expect(recommendRoute).toContain('AI_RECOMMENDATION write threw');
    expect(auditCoverage).toContain('server audit write is fire-and-forget');
    expect(parseRoute).not.toContain('details: { requirement');
    expect(recommendRoute).not.toContain('details: { requirement');
    expect(parseRoute).not.toContain('target_name: input.data.requirement');
    expect(recommendRoute).not.toContain('target_name: input.data.requirement');
  });
});