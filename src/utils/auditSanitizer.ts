const SENSITIVE_KEY = /(password|passcode|access[_-]?token|refresh[_-]?token|authorization|cookie|api[_-]?key|secret|supabase_secret_key)/i;

export function isSensitiveAuditKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function sanitizeAuditPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeAuditPayload(item, depth + 1));
  if (typeof value === 'string') return sanitizeAuditText(value);
  if (!value || typeof value !== 'object') return value;

  const clean: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveAuditKey(key)) {
      clean[key] = '[REDACTED]';
      continue;
    }
    clean[key] = sanitizeAuditPayload(child, depth + 1);
  }
  return clean;
}

export function sanitizeAuditText(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[REDACTED_TOKEN]')
    .replace(/(authorization|cookie|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 1000);
}

/** Ordinary audit never becomes a second store for restricted AI conversation content. */
export function sanitizeAuditDetails(action:string,value:unknown,module?:unknown):Record<string,unknown> {
 const clean=sanitizeAuditPayload(value);
 if(!clean||typeof clean!=='object'||Array.isArray(clean))return {};
 if(!action.toUpperCase().startsWith('AI_')&&module!=='intelligence')return clean as Record<string,unknown>;
 const allowed=new Set(['model','status','outcome','duration_ms','tool_name','result_status','request_id','operation_id','error_code','candidate_count','input_tokens','output_tokens','requirement_length','returned_count','ranking_version','capability_statuses','_schema_version','_evidence']);
 return Object.fromEntries(Object.entries(clean).filter(([key])=>allowed.has(key)));
}
