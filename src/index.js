const ORIGIN = 'https://news.google.com';
const RPC_URL = `${ORIGIN}/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je`;
const ID_PATTERN = /^[A-Za-z0-9_-]{20,}$/;
const PATH_PATTERN = /^\/(?:read|articles|rss\/articles)\/([A-Za-z0-9_-]+)\/?$/;

export class GoogleNewsResolveError extends Error {
  constructor(code, message, { status, retryAfter, cause } = {}) {
    super(message, { cause });
    this.name = 'GoogleNewsResolveError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

export function extractArticleId(input) {
  const value = String(input instanceof URL ? input.href : input ?? '').trim();
  if (ID_PATTERN.test(value)) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new GoogleNewsResolveError('INVALID_INPUT', 'Expected a news.google.com article URL or article ID');
  }
  const match = url.pathname.match(PATH_PATTERN);
  if (url.protocol !== 'https:' || url.hostname !== 'news.google.com' || !match) {
    throw new GoogleNewsResolveError('INVALID_INPUT', 'Expected an HTTPS news.google.com read/articles/rss/articles URL');
  }
  return match[1];
}

function isGoogleHost(hostname) {
  return hostname === 'google.com' || hostname.endsWith('.google.com');
}

function parseRetryAfter(header) {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

async function fetchText(url, init, options) {
  const signals = [AbortSignal.timeout(options.timeoutMs)];
  if (options.signal) signals.push(options.signal);
  let response;
  try {
    response = await options.fetch(url, { ...init, signal: AbortSignal.any(signals) });
  } catch (error) {
    if (options.signal?.aborted) throw new GoogleNewsResolveError('ABORTED', 'Request aborted', { cause: error });
    if (error?.name === 'TimeoutError') {
      throw new GoogleNewsResolveError('TIMEOUT', `Request timed out after ${options.timeoutMs} ms`, { cause: error });
    }
    throw new GoogleNewsResolveError('NETWORK_ERROR', `Request to ${new URL(url).hostname} failed`, { cause: error });
  }
  if (response.status === 429) {
    throw new GoogleNewsResolveError('RATE_LIMITED', 'Google News rate limit (HTTP 429)', {
      status: 429,
      retryAfter: parseRetryAfter(response.headers.get('retry-after')),
    });
  }
  if (!response.ok) {
    throw new GoogleNewsResolveError('HTTP_ERROR', `HTTP ${response.status} from ${new URL(url).hostname}`, {
      status: response.status,
    });
  }
  // Cap decompressed content; never evaluate Google's scripts.
  const chunks = [];
  let size = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > options.maxBytes) {
        throw new GoogleNewsResolveError('RESPONSE_TOO_LARGE', `Response exceeds ${options.maxBytes} bytes`);
      }
      chunks.push(chunk);
    }
  }
  return { text: Buffer.concat(chunks).toString('utf8'), url: response.url };
}

function normalizeOptions(options = {}) {
  const hl = options.hl ?? 'en-US';
  const gl = options.gl ?? 'US';
  return {
    hl,
    gl,
    ceid: options.ceid ?? `${gl}:${hl.split('-')[0]}`,
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? 30_000,
    maxBytes: options.maxBytes ?? 5_000_000,
  };
}

function parseSignature(html, id) {
  // Match attributes on one element, not arbitrary values in the large JS bundle.
  const tags = html.match(/<[^>]*\bdata-n-a-id=[^>]*>/g) ?? [];
  const attributes = tags
    .map(tag => Object.fromEntries(
      [...tag.matchAll(/\bdata-n-a-(id|ts|sg)=["']([^"']*)["']/g)].map(m => [m[1], m[2]]),
    ))
    .find(attrs => attrs.id === id);
  if (!attributes?.sg || !/^\d+$/.test(attributes.ts ?? '')) {
    throw new GoogleNewsResolveError(
      'NO_SIGNATURE',
      'Missing Google News signature/timestamp (consent page, blocking, or markup change)',
    );
  }
  return { timestamp: Number(attributes.ts), signature: attributes.sg };
}

function parseRpcResponse(text) {
  // Skip the anti-XSSI prefix and optional byte-count lines; parse JSON twice.
  for (const line of text.split('\n')) {
    if (!line.startsWith('[[')) continue;
    let rows;
    try {
      rows = JSON.parse(line);
    } catch {
      continue;
    }
    for (const row of rows) {
      if (row[0] !== 'wrb.fr' || row[1] !== 'Fbv4je' || typeof row[2] !== 'string') continue;
      const result = JSON.parse(row[2]);
      if (result[0] !== 'garturlres' || typeof result[1] !== 'string') continue;
      const destination = new URL(result[1]);
      if (!['https:', 'http:'].includes(destination.protocol)) {
        throw new GoogleNewsResolveError('RPC_EMPTY', 'Unexpected destination protocol');
      }
      return destination.href;
    }
  }
  throw new GoogleNewsResolveError('RPC_EMPTY', 'Google News RPC returned no article URL');
}

export async function resolveGoogleNews(input, options) {
  const id = extractArticleId(input);
  const opts = normalizeOptions(options);
  if (typeof opts.fetch !== 'function') throw new TypeError('No fetch implementation available');

  const pageUrl = new URL(`${ORIGIN}/rss/articles/${id}`);
  pageUrl.search = new URLSearchParams({ hl: opts.hl, gl: opts.gl, ceid: opts.ceid });
  const page = await fetchText(pageUrl.href, {}, opts);
  if (page.url) {
    const finalUrl = new URL(page.url);
    if (!isGoogleHost(finalUrl.hostname)) return { url: finalUrl.href, id, method: 'http-redirect' };
  }

  const { timestamp, signature } = parseSignature(page.text, id);
  // Undocumented Google News RPC context; keep the tested wire format intact.
  const context = [
    [opts.hl, opts.gl, ['FINANCE_TOP_INDICES', 'WEB_TEST_1_0_0'], null, null,
      1, 1, opts.ceid, null, 180, null, null, null, null, null, 0, null, null,
      [1608992183, 723341000]],
    opts.hl, opts.gl, 1, [2, 3, 4, 8], 1, 0, '655000234', 0, 0, null, 0,
  ];
  const args = ['garturlreq', context, id, timestamp, signature];
  const rpc = await fetchText(RPC_URL, {
    method: 'POST',
    body: new URLSearchParams({
      'f.req': JSON.stringify([[['Fbv4je', JSON.stringify(args), null, 'generic']]]),
    }),
  }, opts);
  return { url: parseRpcResponse(rpc.text), id, method: 'google-news-rpc' };
}

const sleep = (ms, signal) => new Promise((done, fail) => {
  if (signal?.aborted) return fail(signal.reason);
  const timer = setTimeout(done, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    fail(signal.reason);
  }, { once: true });
});

export async function resolveMany(inputs, options = {}) {
  const { concurrency = 2, delayMs = 250, ...resolveOptions } = options;
  const list = [...inputs];
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const index = next++;
      const input = list[index];
      try {
        results[index] = { input, ...(await resolveGoogleNews(input, resolveOptions)) };
      } catch (error) {
        results[index] = { input, error };
      }
      if (delayMs > 0 && next < list.length) await sleep(delayMs, resolveOptions.signal).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, worker));
  return results;
}
