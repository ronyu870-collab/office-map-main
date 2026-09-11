import {
  ParsedRequirementSchema,
  REQUIREMENT_JSON_SCHEMA,
  type ParsedRequirement,
} from './requirementSchema';
import type { RequirementVocabulary } from './requirementResolver';

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const REQUEST_TIMEOUT_MS = 15_000;

export type DeepSeekParseMeta = {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

type DeepSeekResponse = {
  status?: string;
  model?: string;
  error?: { message?: string } | null;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

export class IntelligenceAIError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 502,
  ) {
    super(message);
    this.name = 'IntelligenceAIError';
  }
}

function uniqueModels() {
  const primary = process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL;
  const fallback = process.env.DEEPSEEK_FALLBACK_MODEL?.trim() || DEFAULT_MODEL;
  return [...new Set([primary, fallback].filter(Boolean))];
}

function extractOutputText(payload: DeepSeekResponse) {
  for (const item of payload.output ?? []) {
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part.type === 'output_text' && part.text?.trim()) return part.text.trim();
    }
  }
  return null;
}

function beijingDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function promptFor(requirement: string, vocabulary: RequirementVocabulary) {
  return [
    `Current Beijing date: ${beijingDate()}`,
    'Task: extract one Beijing office-leasing client requirement into the required JSON schema.',
    'Rules:',
    '- Extract only what the user actually says or what is necessary to normalize dates/units.',
    '- Never invent a building, rent, vacancy, availability, company fact, or client preference.',
    '- For normalizedDistrict, normalizedSubmarket, and grades, use an exact value from the supplied vocabulary or null/omit from grades.',
    '- If a location cannot be matched confidently, preserve the original wording in raw and add it to unresolved.',
    '- Convert area to square metres and rent to RMB/sqm/day only when the conversion is unambiguous.',
    '- If the user says a relative month such as “11月”, resolve it to YYYY-MM using the current Beijing date.',
    '- If rent basis is not explicit, use basis="unspecified".',
    '- “地铁近/交通方便” means metro.preferred=true; only set maxDistanceMeters when a numeric distance is stated.',
    '- Output only data conforming to the JSON schema.',
    '',
    `Allowed districts: ${JSON.stringify(vocabulary.districts)}`,
    `Allowed submarkets: ${JSON.stringify(vocabulary.submarkets)}`,
    `Allowed grades: ${JSON.stringify(vocabulary.grades)}`,
    '',
    `Client requirement: ${requirement}`,
  ].join('\n');
}

async function requestDeepSeek(
  model: string,
  requirement: string,
  vocabulary: RequirementVocabulary,
): Promise<{ parsed: ParsedRequirement; meta: DeepSeekParseMeta }> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new IntelligenceAIError('DeepSeek API 尚未配置，请先在 Vercel 设置 DEEPSEEK_API_KEY。', 503);
  }

  const baseUrl = (process.env.DEEPSEEK_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        instructions: 'You are a precise structured-data extractor for a commercial real-estate system. Do not answer conversationally.',
        input: promptFor(requirement, vocabulary),
        reasoning: { effort: 'none' },
        max_output_tokens: 1400,
        text: {
          format: {
            type: 'json_schema',
            name: 'office_requirement',
            schema: REQUIREMENT_JSON_SCHEMA,
          },
        },
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    let payload: DeepSeekResponse | null = null;
    try {
      payload = await response.json() as DeepSeekResponse;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const providerMessage = payload?.error?.message?.trim();
      throw new IntelligenceAIError(
        providerMessage ? `DeepSeek 请求失败：${providerMessage}` : `DeepSeek 请求失败（HTTP ${response.status}）`,
        response.status === 401 || response.status === 403 ? 503 : 502,
      );
    }

    if (payload?.status && payload.status !== 'completed') {
      throw new IntelligenceAIError('DeepSeek 未完整返回结构化结果，请重试。');
    }

    const outputText = payload ? extractOutputText(payload) : null;
    if (!outputText) throw new IntelligenceAIError('DeepSeek 返回了空结果，请重试。');

    let json: unknown;
    try {
      json = JSON.parse(outputText);
    } catch {
      throw new IntelligenceAIError('DeepSeek 返回内容无法解析为 JSON，请重试。');
    }

    const parsed = ParsedRequirementSchema.safeParse(json);
    if (!parsed.success) {
      throw new IntelligenceAIError('DeepSeek 返回结构未通过业务校验，请重试。');
    }

    return {
      parsed: parsed.data,
      meta: {
        model: payload?.model || model,
        inputTokens: payload?.usage?.input_tokens ?? null,
        outputTokens: payload?.usage?.output_tokens ?? null,
      },
    };
  } catch (error) {
    if (error instanceof IntelligenceAIError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new IntelligenceAIError('DeepSeek 响应超时，请稍后重试。', 504);
    }
    throw new IntelligenceAIError('DeepSeek 暂时不可用，请稍后重试。');
  } finally {
    clearTimeout(timeout);
  }
}

export async function parseRequirementWithDeepSeek(
  requirement: string,
  vocabulary: RequirementVocabulary,
) {
  let lastError: IntelligenceAIError | null = null;

  for (const model of uniqueModels()) {
    try {
      return await requestDeepSeek(model, requirement, vocabulary);
    } catch (error) {
      if (!(error instanceof IntelligenceAIError)) throw error;
      lastError = error;
      if (error.statusCode === 503 && /API 尚未配置|认证|API key|API Key/i.test(error.message)) break;
    }
  }

  throw lastError ?? new IntelligenceAIError('DeepSeek 暂时不可用，请稍后重试。');
}
