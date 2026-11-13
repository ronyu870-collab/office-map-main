/** Paired local production-route benchmark. All identity, data, and Storage responses are synthetic. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const sharp = require('sharp');
const budget = JSON.parse(await fs.readFile(new URL('./budgets.json', import.meta.url), 'utf8')).buildingPhotos;
const [beforeDir, afterDir, output, count = String(budget.samplesPerProfile)] = process.argv.slice(2);
const samples = Number(count);
assert.ok(beforeDir && afterDir && output && Number.isInteger(samples) && samples >= budget.samplesPerProfile,
  'Usage: node scripts/performance/benchmark-building-photos.mjs BASELINE_BUILD_DIR CANDIDATE_BUILD_DIR REPORT_JSON [SAMPLES >= 20]');
const buildingId = '11111111-1111-4111-8111-111111111111';
const photoId = '22222222-2222-4222-8222-222222222222';
const callerId = '33333333-3333-4333-8333-333333333333';
const storagePath = `building-photos/v1/${buildingId}/${photoId}/original.jpg`;
const objectKey = 'building-sales-materials/' + storagePath;
const authHeader = 'Bearer synthetic-photo-viewer';
const interserviceLatencyMs = 45;
const sourceWidth = 3200, sourceHeight = 2200;
const pixels = Buffer.alloc(sourceWidth * sourceHeight * 3);
let seed = 42;
for (let i = 0; i < pixels.length; i++) {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  pixels[i] = seed & 255;
}
const original = await sharp(pixels, { raw: { width: sourceWidth, height: sourceHeight, channels: 3 } }).jpeg({ quality: 91 }).toBuffer();
const transformed = new Map();
const signed = new Map();
const servers = [];
const children = [];
const listener = async handler => {
  const server = http.createServer((req, res) => {
    void handler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
};
const json = (res, body, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
const body = async req => {
  const chunks = [];
  for await (const part of req) chunks.push(part);
  return JSON.parse(Buffer.concat(chunks).toString());
};
const storageBase = await listener(async (req, res) => {
  const url = new URL(req.url, 'http://fixture.local');
  if (req.method === 'GET' && (url.pathname.endsWith('/' + objectKey))) {
    const token = signed.get(url.searchParams.get('token'));
    if (!token) return json(res, { error: 'invalid link' }, 403);
    const bytes = token.preview ? await token.preview : original;
    res.writeHead(200, {
      'Content-Type': token.preview ? 'image/webp' : 'image/jpeg', 'Content-Length': bytes.length,
      'Timing-Allow-Origin': '*', 'Cache-Control': 'no-store',
    });
    return res.end(bytes);
  }
  // A fixed inter-service RTT per Supabase call. Browser bandwidth/RTT are emulated separately.
  await delay(interserviceLatencyMs);
  switch (url.pathname) {
    case '/auth/v1/user':
      assert.equal(req.headers.authorization, authHeader);
      return json(res, { id: callerId, email: 'synthetic@invalid.test', aud: 'authenticated' });
    case '/rest/v1/user_roles':
      assert.equal(url.searchParams.get('user_id'), 'eq.' + callerId);
      return json(res, [{ role: 'viewer' }]);
    case '/rest/v1/buildings':
      assert.equal(url.searchParams.get('id'), 'eq.' + buildingId);
      assert.equal(url.searchParams.get('is_active'), 'eq.true');
      assert.equal(url.searchParams.get('tracking_scope'), 'eq.tracked');
      return json(res, [{ id: buildingId, name: '照片性能夹具' }]);
    case '/rest/v1/building_photos':
      assert.equal(url.searchParams.get('building_id'), 'eq.' + buildingId);
      assert.equal(url.searchParams.get('id'), 'eq.' + photoId);
      assert.equal(url.searchParams.get('status'), 'eq.ready');
      return json(res, [{ id: photoId, caption: '外观', width: sourceWidth, height: sourceHeight,
        storage_path: storagePath, file_size: original.length, source_name: 'Synthetic', source_url: 'https://www.archdaily.com/project' }]);
    case '/rest/v1/audit_logs':
      assert.equal((await body(req)).action_type, 'BUILDING_PHOTO_ACCESS');
      res.writeHead(201);
      return res.end();
    case '/storage/v1/object/sign/' + objectKey: {
      const { expiresIn, transform } = await body(req);
      assert.equal(expiresIn, 300);
      const token = String(signed.size + 1);
      const route = transform ? 'render/image/sign' : 'object/sign';
      let preview;
      if (transform) {
        assert.equal(transform.resize, 'contain');
        assert.ok(transform.width > 0 && transform.height > 0 && transform.quality > 0);
        const key = JSON.stringify(transform);
        if (!transformed.has(key)) {
          transformed.set(key, sharp(original).resize({
            width: transform.width, height: transform.height, fit: 'inside', withoutEnlargement: true,
          }).webp({ quality: transform.quality }).toBuffer());
        }
        preview = transformed.get(key);
      }
      signed.set(token, { preview });
      return json(res, { signedURL: `/${route}/${objectKey}?token=${token}` });
    }
    default: return json(res, { error: 'unexpected fixture path' }, 404);
  }
});

async function startApp(directory) {
  const next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', '0'], {
    cwd: path.resolve(directory),
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: storageBase, SUPABASE_SECRET_KEY: 'synthetic-only',
      BUILDING_PHOTO_PREVIEWS_ENABLED: '1' },
  });
  children.push(next);
  const app = await new Promise((resolve, reject) => {
    let logs = '';
    const timer = setTimeout(() => reject(new Error('Local build did not start')), 20000);
    next.stdout.on('data', chunk => {
      logs += String(chunk);
      const address = logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (address && logs.includes('Ready')) { clearTimeout(timer); resolve(address); }
    });
    next.once('exit', code => { clearTimeout(timer); reject(new Error('Local build exited: ' + code)); });
  });
  const files = {
    '@/src/lib/building-photos/model': 'src/lib/building-photos/model.ts',
    '../buildingPhotosClient': 'src/services/buildingPhotosClient.ts',
    '@/src/services/impersonationHeaders': 'src/services/impersonationHeaders.ts',
    gallery: 'src/services/map/buildingPhotoGallery.ts',
  };
  const modules = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [
    key, ts.transpileModule(await fs.readFile(path.join(directory, file), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
  ])));
  const script = `
    const sources = ${JSON.stringify(modules)}, cache = {};
    function require(name) {
      if (name === '@/src/services/Auth') return {getSessionFast: async () => ({session:{access_token:'synthetic-photo-viewer'}})};
      if (!cache[name]) {
        const mod = {exports:{}}; cache[name] = mod;
        new Function('require','module','exports',sources[name])(require,mod,mod.exports);
      }
      return cache[name].exports;
    }
    const g = require('gallery'), root = document.querySelector('section');
    const photos = [{id:'${photoId}',caption:'外观'}];
    root.innerHTML = g.buildPhotoTrigger('fixture') + g.buildPhotoGallery('fixture','照片性能夹具',photos);
    g.bindBuildingPhotoGallery(root,'${buildingId}',photos);
  `;
  const css = await fs.readFile(path.join(directory, 'src/app/map/map-building-popup.css'), 'utf8');
  return listener(async (req, res) => {
    if (req.url.startsWith('/api/map/building-photos?')) {
      const result = await fetch(app + req.url, { headers: { Authorization: req.headers.authorization ?? '' } });
      return json(res, await result.json(), result.status);
    }
    if (req.url === '/fixture.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(script);
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>[hidden]{display:none!important}section{width:min(360px,100%)}${css}</style><section></section><script src="/fixture.js"></script></html>`);
  });
}

async function readPhoto(page, trigger, touch) {
  await page.evaluate(() => {
    window.photoTiming = new Promise((resolve, reject) => {
      const trigger = document.querySelector('[data-building-photo-trigger]');
      const image = document.querySelector('[data-building-photo]');
      const gallery = document.querySelector('[data-building-photo-gallery]');
      trigger.addEventListener('click', () => {
        const start = performance.now();
        let feedback = null;
        const timeout = setTimeout(() => reject(new Error('Photo did not render')), 15000);
        const check = () => {
          if (feedback === null && !gallery.hidden) feedback = performance.now() - start;
          if (!gallery.hidden && !image.hidden && image.complete && image.naturalWidth && image.getBoundingClientRect().height > 0) {
            // Explicit decode followed by a painted frame; a loaded URL or skeleton is not enough.
            void image.decode().then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
              clearTimeout(timeout);
              const resource = performance.getEntriesByName(image.currentSrc).at(-1);
              const api = performance.getEntriesByType('resource').find(entry => entry.name.includes('/api/map/building-photos?'));
              resolve({ feedbackMs: feedback, visibleMs: performance.now() - start,
                bytes: resource?.encodedBodySize ?? null, imageMs: resource?.duration ?? null, apiMs: api?.duration ?? null });
            }))).catch(error => { clearTimeout(timeout); reject(error); });
          } else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }, { capture: true, once: true });
    });
  });
  if (touch) await trigger.tap();
  else await trigger.click();
  return page.evaluate(() => window.photoTiming);
}

async function sample(browser, url, name, profile) {
  const touch = name === 'mobile';
  const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, isMobile: touch, hasTouch: touch });
  try {
    await page.goto(url);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: profile.latencyMs,
      downloadThroughput: profile.downloadMbps * 1e6 / 8, uploadThroughput: 3e6 / 8,
    });
    const trigger = page.getByRole('button', { name: '看图' });
    const cold = await readPhoto(page, trigger, touch);
    if (touch) await trigger.tap();
    else await trigger.click();
    const warm = await readPhoto(page, trigger, touch);
    assert.ok(cold.bytes > 0 && cold.apiMs > 0 && cold.imageMs > 0);
    return { cold, warm };
  } catch (error) {
    return { error: error.name };
  } finally {
    await page.close();
  }
}

const summarize = rows => {
  const successes = rows.filter(row => !row.error);
  const percentile = (select, p) => {
    const values = successes.map(select).sort((a, b) => a - b);
    return values.length ? Math.round(values[Math.ceil(values.length * p) - 1]) : null;
  };
  return {
    samples: rows.length, failures: rows.length - successes.length,
    feedbackP90Ms: percentile(row => row.cold.feedbackMs, 0.9),
    firstPhotoP50Ms: percentile(row => row.cold.visibleMs, 0.5),
    firstPhotoP90Ms: percentile(row => row.cold.visibleMs, 0.9),
    reopenP90Ms: percentile(row => row.warm.visibleMs, 0.9),
    photoBytesP90: percentile(row => row.cold.bytes, 0.9),
    apiP90Ms: percentile(row => row.cold.apiMs, 0.9),
    imageRequestP90Ms: percentile(row => row.cold.imageMs, 0.9),
  };
};
let browser;
try {
  const urls = { before: await startApp(beforeDir), after: await startApp(afterDir) };
  browser = await chromium.launch({ headless: true, ...(process.env.PERF_BROWSER_EXECUTABLE_PATH
    ? { executablePath: process.env.PERF_BROWSER_EXECUTABLE_PATH, args: ['--no-sandbox'] } : {}) });
  const profiles = Object.fromEntries(await Promise.all(Object.entries(budget.profiles).map(async ([name, profile]) => {
    const rows = { before: [], after: [] };
    for (let i = 0; i < samples; i++) {
      for (const arm of i % 2 === 0 ? ['before', 'after'] : ['after', 'before']) {
        rows[arm].push(await sample(browser, urls[arm], name, profile));
      }
    }
    const before = summarize(rows.before), after = summarize(rows.after);
    const passed = before.failures === 0 && after.failures === 0 && after.firstPhotoP90Ms <= profile.firstPhotoP90Ms
      && after.feedbackP90Ms <= budget.feedbackP90Ms && after.reopenP90Ms <= budget.reopenP90Ms;
    return [name, { profile, before, after, passed, rows }];
  })));
  const passed = Object.values(profiles).every(row => row.passed);
  const report = { passed, browser: browser.version(), originalBytes: original.length, mockInterserviceLatencyMs: interserviceLatencyMs,
    scope: 'local production-built API + source gallery; simulated browser network, viewer identity, and Storage', profiles };
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, profiles: Object.fromEntries(Object.entries(profiles).map(([name, { profile, before, after, passed }]) => [name, { profile, before, after, passed }])) }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await browser?.close();
  children.forEach(child => child.kill());
  await Promise.all(servers.map(server => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  }));
}
