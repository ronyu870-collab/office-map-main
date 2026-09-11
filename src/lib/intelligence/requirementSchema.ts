import { z } from 'zod';

const nullableNonNegativeNumber = z.number().finite().min(0).nullable();

export const ParsedRequirementSchema = z.object({
  city: z.string().trim().min(1).max(40),
  locations: z.array(z.object({
    raw: z.string().trim().min(1).max(80),
    kind: z.enum(['submarket', 'district', 'landmark', 'other']),
    normalizedDistrict: z.string().trim().min(1).max(80).nullable(),
    normalizedSubmarket: z.string().trim().min(1).max(80).nullable(),
  }).strict()).max(8),
  area: z.object({
    minSqm: nullableNonNegativeNumber,
    maxSqm: nullableNonNegativeNumber,
  }).strict(),
  rent: z.object({
    minDailyRmbSqm: nullableNonNegativeNumber,
    maxDailyRmbSqm: nullableNonNegativeNumber,
    basis: z.enum(['net_effective', 'asking', 'unspecified']),
  }).strict(),
  moveInMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  grades: z.array(z.string().trim().min(1).max(40)).max(8),
  metro: z.object({
    preferred: z.boolean(),
    maxDistanceMeters: nullableNonNegativeNumber,
  }).strict(),
  greenCertifications: z.array(z.string().trim().min(1).max(60)).max(8),
  otherPreferences: z.array(z.string().trim().min(1).max(160)).max(12),
  unresolved: z.array(z.string().trim().min(1).max(200)).max(12),
}).strict();

export type ParsedRequirement = z.infer<typeof ParsedRequirementSchema>;

export const RequirementParseInputSchema = z.object({
  requirement: z.string().trim().min(2, '请先输入客户需求').max(1200, '客户需求过长，请精简后重试'),
}).strict();

export type RequirementSupportStatus = 'supported' | 'partial' | 'unsupported';

export type RequirementCapability = {
  key: 'location' | 'area' | 'rent' | 'moveIn' | 'grade' | 'metro' | 'green' | 'other';
  label: string;
  value: string;
  status: RequirementSupportStatus;
  explanation: string;
  dataBasis: string | null;
};

export type RequirementParseResult = {
  parsed: ParsedRequirement;
  capabilities: RequirementCapability[];
  meta: {
    model: string;
    durationMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
  };
};

export const REQUIREMENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    city: { type: 'string' },
    locations: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          raw: { type: 'string' },
          kind: { type: 'string', enum: ['submarket', 'district', 'landmark', 'other'] },
          normalizedDistrict: { type: ['string', 'null'] },
          normalizedSubmarket: { type: ['string', 'null'] },
        },
        required: ['raw', 'kind', 'normalizedDistrict', 'normalizedSubmarket'],
      },
    },
    area: {
      type: 'object',
      additionalProperties: false,
      properties: {
        minSqm: { type: ['number', 'null'], minimum: 0 },
        maxSqm: { type: ['number', 'null'], minimum: 0 },
      },
      required: ['minSqm', 'maxSqm'],
    },
    rent: {
      type: 'object',
      additionalProperties: false,
      properties: {
        minDailyRmbSqm: { type: ['number', 'null'], minimum: 0 },
        maxDailyRmbSqm: { type: ['number', 'null'], minimum: 0 },
        basis: { type: 'string', enum: ['net_effective', 'asking', 'unspecified'] },
      },
      required: ['minDailyRmbSqm', 'maxDailyRmbSqm', 'basis'],
    },
    moveInMonth: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}$' },
    grades: { type: 'array', maxItems: 8, items: { type: 'string' } },
    metro: {
      type: 'object',
      additionalProperties: false,
      properties: {
        preferred: { type: 'boolean' },
        maxDistanceMeters: { type: ['number', 'null'], minimum: 0 },
      },
      required: ['preferred', 'maxDistanceMeters'],
    },
    greenCertifications: { type: 'array', maxItems: 8, items: { type: 'string' } },
    otherPreferences: { type: 'array', maxItems: 12, items: { type: 'string' } },
    unresolved: { type: 'array', maxItems: 12, items: { type: 'string' } },
  },
  required: [
    'city',
    'locations',
    'area',
    'rent',
    'moveInMonth',
    'grades',
    'metro',
    'greenCertifications',
    'otherPreferences',
    'unresolved',
  ],
} as const;
