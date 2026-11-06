import { Readable } from 'node:stream';
// Handles the serialized HTTP requests produced by the real AWS SDK, without
// opening a listener. This is not evidence of real R2 transport, IAM or locks.
export async function s3Fixture() {
  const objects = new Map(); const requests = []; let corruptNextGet = false; let failPutAt = Infinity; let puts = 0; let interruptedGets = 0; let getStatus;
  const response = (statusCode, data, headers = {}) => ({ response: { statusCode, headers: { 'content-type': 'application/xml', ...headers }, body: Readable.from([Buffer.from(data)]) } });
  const requestHandler = {
    async handle(req) {
      const key = decodeURIComponent(req.path.split('/').slice(2).join('/'));
      requests.push({ method: req.method, key, condition: req.headers['if-none-match'], signed: req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ') });
      if (req.method === 'PUT') {
        if (++puts >= failPutAt) return response(403, '<Error><Code>AccessDenied</Code></Error>');
        if (req.headers['if-none-match'] !== '*' || objects.has(key)) return response(412, '<Error><Code>PreconditionFailed</Code></Error>');
        const parts = []; for await (const p of req.body) parts.push(p);
        objects.set(key, Buffer.concat(parts)); return response(200, '', { etag: '"fixture"' });
      }
      if (req.query?.['list-type']) {
        const prefix = req.query.prefix || '';
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        const start = Number(req.query['continuation-token'] || 0); const batch = keys.slice(start, start + 2);
        const truncated = start + 2 < keys.length;
        return response(200, `<ListBucketResult><IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${start + 2}</NextContinuationToken>` : ''}${batch.map((k) => `<Contents><Key>${k}</Key><Size>${objects.get(k).length}</Size></Contents>`).join('')}</ListBucketResult>`);
      }
      if (req.method === 'GET' && objects.has(key)) {
        if (getStatus) return response(getStatus, '<Error><Code>AccessDenied</Code></Error>');
        let body = objects.get(key);
        if (corruptNextGet) { corruptNextGet = false; body = Buffer.concat([body, Buffer.from('tampered')]); }
        if (interruptedGets > 0) {
          interruptedGets--;
          return { response: { statusCode: 200, headers: { 'content-length': String(body.length), 'content-type': 'application/octet-stream' }, body: Readable.from((async function* () {
            yield body.subarray(0, 4);
            throw Object.assign(new Error('synthetic socket reset'), { code: 'ECONNRESET' });
          })()) } };
        }
        return response(200, body, { 'content-length': String(body.length), 'content-type': 'application/octet-stream' });
      }
      return response(404, '<Error><Code>NoSuchKey</Code></Error>');
    },
    destroy() {},
  };
  return { endpoint: 'http://127.0.0.1:9', requestHandler, objects, requests,
    corruptGet() { corruptNextGet = true; }, failPut(n) { puts = 0; failPutAt = n; }, close: async () => {},
    interruptGet(n) { interruptedGets = n; }, denyGet(status) { getStatus = status; },
  };
}
