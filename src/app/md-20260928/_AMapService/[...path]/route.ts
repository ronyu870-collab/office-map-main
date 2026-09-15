const ALLOWED_ORIGINS = new Set([
  'null',
  'https://colliersdata.com',
  'https://www.colliersdata.com',
  'https://colliersdata-ronyu870-9030s-projects.vercel.app',
  'https://colliersdata-git-main-ronyu870-9030s-projects.vercel.app',
]);

const EXPIRY = Date.parse('2026-10-15T00:00:00+08:00');

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin');
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept',
    'Vary': 'Origin',
  };
}

function isAllowedRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

function getSecurityCode(): string {
  return (
    process.env.AMAP_SECURITY_CODE ||
    process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE ||
    ''
  ).trim();
}

function upstreamFor(path: string): string {
  if (path.startsWith('v4/map/styles')) {
    return `https://webapi.amap.com/${path}`;
  }
  return `https://restapi.amap.com/${path}`;
}

async function proxy(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  if (Date.now() >= EXPIRY) {
    return new Response('Meeting proxy expired', { status: 410 });
  }
  if (!isAllowedRequest(request)) {
    return new Response('Origin not allowed', {
      status: 403,
      headers: corsHeaders(request),
    });
  }

  const securityCode = getSecurityCode();
  if (!securityCode) {
    return new Response('AMap security code is not configured', {
      status: 503,
      headers: corsHeaders(request),
    });
  }

  const { path: parts = [] } = await context.params;
  const path = parts.map(part => encodeURIComponent(decodeURIComponent(part))).join('/');
  if (!path) {
    return new Response('Missing AMap service path', {
      status: 400,
      headers: corsHeaders(request),
    });
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(upstreamFor(path));
  incomingUrl.searchParams.forEach((value, key) => {
    if (key !== 'jscode') upstreamUrl.searchParams.append(key, value);
  });
  upstreamUrl.searchParams.set('jscode', securityCode);

  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  const accept = request.headers.get('accept');
  if (contentType) headers.set('content-type', contentType);
  if (accept) headers.set('accept', accept);

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'follow',
    cache: 'no-store',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  try {
    const upstream = await fetch(upstreamUrl, init);
    const responseHeaders = new Headers(corsHeaders(request));
    const upstreamType = upstream.headers.get('content-type');
    if (upstreamType) responseHeaders.set('content-type', upstreamType);
    responseHeaders.set('Cache-Control', 'no-store');

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('[AMap meeting proxy] upstream request failed', error);
    return new Response('AMap upstream request failed', {
      status: 502,
      headers: corsHeaders(request),
    });
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  return proxy(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  return proxy(request, context);
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}
