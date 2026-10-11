# @webcrawlerapi/google-news-url-resolver

Resolve `news.google.com` article links (from Google News RSS feeds or the web
UI) to the original publisher URLs.

- Zero dependencies, no headless browser, no API key
- Two HTTP requests per article: the article page for a signature, then Google's signed `batchexecute` RPC
- Typed errors with retry hints, a concurrency-limited batch helper, and a CLI
- ESM with TypeScript types. Node.js 20.3+

```sh
npm install @webcrawlerapi/google-news-url-resolver
```

## Usage

```js
import { resolveGoogleNews } from '@webcrawlerapi/google-news-url-resolver';

const { url } = await resolveGoogleNews(
  'https://news.google.com/rss/articles/CBMiswFBVV95cUxP...?oc=5',
);
// https://www.reuters.com/world/china/...
```

Accepted input: `https://news.google.com/read/<id>`, `/articles/<id>`,
`/rss/articles/<id>` (query string ignored), or a bare article ID.

### Options

```js
await resolveGoogleNews(url, {
  hl: 'en-US',          // interface language
  gl: 'US',             // country
  ceid: 'US:en',        // edition, derived from hl/gl by default
  timeoutMs: 30_000,    // per request
  maxBytes: 5_000_000,  // response size cap
  signal,               // AbortSignal
  fetch,                // custom fetch, e.g. with a proxy dispatcher
});
```

Result: `{ url, id, method }`. `method` is `'google-news-rpc'`, or
`'http-redirect'` if Google redirected straight to the publisher.

### Many URLs

```js
import { resolveMany } from '@webcrawlerapi/google-news-url-resolver';

const results = await resolveMany(urls, { concurrency: 2, delayMs: 250 });
for (const r of results) {
  if (r.error) console.error(r.input, r.error.code);
  else console.log(r.url);
}
```

`resolveMany` never rejects. Results keep the input order, and failed items carry
an `error` instead of a `url`.

### Errors

Failures throw a `GoogleNewsResolveError` with a `code`:

| Code | Meaning |
| --- | --- |
| `INVALID_INPUT` | Not a Google News article URL or ID |
| `RATE_LIMITED` | HTTP 429. `retryAfter` (seconds) is set when Google sends it. Back off |
| `HTTP_ERROR` | Other non-2xx status (`status` is set) |
| `NETWORK_ERROR` / `TIMEOUT` / `ABORTED` | Transport failure |
| `RESPONSE_TOO_LARGE` | Response exceeded `maxBytes` |
| `NO_SIGNATURE` | Article page had no signature (consent page, blocking, or markup change) |
| `RPC_EMPTY` | RPC succeeded but returned no URL |

```js
import { GoogleNewsResolveError } from '@webcrawlerapi/google-news-url-resolver';

try {
  await resolveGoogleNews(url);
} catch (error) {
  if (error instanceof GoogleNewsResolveError && error.code === 'RATE_LIMITED') {
    // wait error.retryAfter seconds
  }
}
```

### CommonJS

The package is ESM-only. Node.js 20.19+ and 22.12+ can `require()` it directly:

```js
const { resolveGoogleNews } = require('@webcrawlerapi/google-news-url-resolver');
```

On older versions, use `await import(...)`.

## CLI

```sh
npx @webcrawlerapi/google-news-url-resolver 'https://news.google.com/rss/articles/...'
cat urls.txt | npx @webcrawlerapi/google-news-url-resolver --json
```

By default the CLI prints one publisher URL per line and writes failures to
stderr. `--json` prints one object per line with `input`. Other flags:
`--hl`, `--gl`, `--ceid`, `--concurrency`, `--delay`, `--timeout`. The exit code
is 1 if any URL failed.

## Caveats

This relies on an undocumented Google News endpoint, not a supported API.
Markup or RPC changes, consent pages, and rate limits can break it. Cache
resolved URLs, keep concurrency low, and back off on `RATE_LIMITED`.

Resolving the URL does not fetch the article. To get the publisher page as
clean markdown, use [WebCrawlerAPI](https://webcrawlerapi.com).

A Go version is available at
[WebCrawlerAPI/google-news-go](https://github.com/WebCrawlerAPI/google-news-go).

## License

MIT
