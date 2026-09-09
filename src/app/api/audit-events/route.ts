import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuditRequestContext } from '@/src/utils/server/auditRequestContext';
import { sanitizeAuditPayload, sanitizeAuditText } from '@/src/utils/auditSanitizer';
import { getSessionIdFromAccessToken } from '@/src/utils/authSession';

export const dynamic = 'force-dynamic';

const MAX_EVENTS_PER_REQUEST = 20;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_TEXT_LENGTH = 500;
const MAX_DETAILS_BYTES = 8 * 1024;

type ClientEvent = Record<string, unknown>;

function text(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, maxLength) : null;
}

function jsonWithinLimit(value: unknown, maxBytes: number): Record<string, unknown> {
  const sanitized = sanitizeAuditPayload(value);
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) return {};
  try {
    const serialized = JSON.stringify(sanitized);
    if (serialized.length <= maxBytes) return sanitized as Record<string, unknown>;
    return { _truncated: true, _original_size: serialized.length };
  } catch {
    return { _unserializable: true };
  }
}

function occurredAt(value: unknown): string {
  if (typeof value === 'string') {
    const time = Date.parse(value);
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return new Date().toISOString();
}

function hasStaleOrigin(event: ClientEvent, userId: string, authSessionId: string | null): boolean {
  const originUserId = text(event.origin_user_id, 100);
  const originSessionId = text(event.origin_auth_session_id, 100);
  if (originUserId && originUserId !== userId) return true;
  if (originSessionId && (!authSessionId || originSessionId !== authSessionId)) return true;
  return false;
}

function normalizeEvent(
  event: ClientEvent,
  userId: string,
  authSessionId: string | null,
  requestContext: ReturnType<typeof getAuditRequestContext>,
) {
  const eventId = text(event.event_id, 100);
  const actionType = text(event.action_type, 100);
  if (!eventId || !actionType || !/^[A-Za-z0-9_-]+$/.test(actionType)) return null;

  const duration = typeof event.duration_ms === 'number' && Number.isFinite(event.duration_ms)
    ? Math.max(0, Math.min(Math.round(event.duration_ms), 3_600_000))
    : null;

  return {
    event_id: eventId,
    user_id: userId,
    action_type: actionType,
    details: jsonWithinLimit(event.details, MAX_DETAILS_BYTES),
    request_source: 'frontend',
    module: text(event.module, 100),
    page_url: text(event.page_url, 500),
    target_table: text(event.target_table, 100),
    target_id: text(event.target_id, 200),
    target_name: text(event.target_name, 500),
    old_values: jsonWithinLimit(event.old_values, MAX_DETAILS_BYTES),
    new_values: jsonWithinLimit(event.new_values, MAX_DETAILS_BYTES),
    duration_ms: duration,
    error_message: sanitizeAuditText(text(event.error_message, 1000)),
    occurred_at: occurredAt(event.occurred_at),
    auth_session_id: authSessionId,
    client_device_id: text(event.client_device_id, 100),
    ip_address: requestContext.ipAddress,
    ip_country: requestContext.country,
    ip_region: requestContext.region,
    ip_city: requestContext.city,
    user_agent: requestContext.userAgent,
    browser_name: requestContext.browserName,
    browser_version: requestContext.browserVersion,
    os_name: requestContext.osName,
    os_version: requestContext.osVersion,
    device_type: requestContext.deviceType,
  };
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: '日志批次过大' }, { status: 413 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  const accessToken = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return NextResponse.json({ error: '未认证' }, { status: 401 });

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
  if (authError || !user) return NextResponse.json({ error: '认证已失效' }, { status: 401 });

  // The JWT has just been verified by getUser. Decoding session_id here is used
  // only after verification, while user_id remains sourced from the Auth server.
  const authSessionId = getSessionIdFromAccessToken(accessToken);
  const requestContext = getAuditRequestContext(request);

  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: '日志批次过大' }, { status: 413 });
    const body = JSON.parse(raw) as { events?: unknown };
    if (!Array.isArray(body.events) || body.events.length === 0 || body.events.length > MAX_EVENTS_PER_REQUEST) {
      return NextResponse.json({ error: '日志批次格式无效' }, { status: 400 });
    }

    const candidates = body.events.filter((event): event is ClientEvent => Boolean(event) && typeof event === 'object' && !Array.isArray(event));
    const discardedEventIds: string[] = [];
    const events = candidates.flatMap(event => {
      const eventId = text(event.event_id, 100);
      if (hasStaleOrigin(event, user.id, authSessionId)) {
        if (eventId) discardedEventIds.push(eventId);
        return [];
      }
      const normalized = normalizeEvent(event, user.id, authSessionId, requestContext);
      return normalized ? [normalized] : [];
    });

    if (events.length) {
      const { error } = await supabaseAdmin
        .from('audit_logs')
        .upsert(events, { onConflict: 'event_id', ignoreDuplicates: true });
      if (error) {
        console.error('[audit-events] 写入失败', error.code, error.message);
        return NextResponse.json({ error: '日志暂存失败' }, { status: 500 });
      }
    }

    if (!events.length && !discardedEventIds.length) {
      return NextResponse.json({ error: '没有可写入的日志' }, { status: 400 });
    }

    return NextResponse.json({
      accepted_event_ids: events.map(event => event.event_id),
      discarded_event_ids: discardedEventIds,
    });
  } catch {
    return NextResponse.json({ error: '日志请求解析失败' }, { status: 400 });
  }
}
