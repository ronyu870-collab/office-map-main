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
    expect(parser).toContain("/responses");
    expect(parser).toContain("type: 'json_schema'");
    expect(parser).toContain("reasoning: { effort: 'none' }");
    expect(parser).toContain("cache: 'no-store'");
    expect(parser).not.toContain('NEXT_PUBLIC_DEEPSEEK');
    expect(envExample).toContain('DEEPSEEK_API_KEY=sk_REPLACE_ME');
    expect(envExample).not.toContain('NEXT_PUBLIC_DEEPSEEK');
  });

  it('requires verified authentication and Intelligence Preview access before model calls', () => {
    const route = source('src/app/api/intelligence/parse-requirement/route.ts');

    expect(route).toContain('auth.getUser(accessToken)');
    expect(route).toContain(".from('user_roles')");
    expect(route).toContain('isIntelligencePreviewEnabled(roleRow.role)');
    expect(route).toContain('RequirementParseInputSchema.safeParse');
    expect(route).toContain('normalizeRequirementAgainstVocabulary');
  });

  it('audits AI usage metadata without persisting the raw client requirement', () => {
    const route = source('src/app/api/intelligence/parse-requirement/route.ts');

    expect(route).toContain("action_type: 'AI_REQUIREMENT_PARSE'");
    expect(route).toContain('requirement_length: requirementLength');
    expect(route).toContain('input_tokens: result.meta.inputTokens');
    expect(route).not.toContain('details: { requirement');
    expect(route).not.toContain('target_name: input.data.requirement');
  });
});
