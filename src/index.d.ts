export type GoogleNewsResolveErrorCode =
  | 'INVALID_INPUT'
  | 'HTTP_ERROR'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'RESPONSE_TOO_LARGE'
  | 'NO_SIGNATURE'
  | 'RPC_EMPTY';

export class GoogleNewsResolveError extends Error {
  name: 'GoogleNewsResolveError';
  code: GoogleNewsResolveErrorCode;
  /** HTTP status for HTTP_ERROR and RATE_LIMITED. */
  status?: number;
  /** Seconds to wait, from the Retry-After header on RATE_LIMITED. */
  retryAfter?: number;
}

export interface ResolveOptions {
  /** Interface language. Default `en-US`. */
  hl?: string;
  /** Country. Default `US`. */
  gl?: string;
  /** Edition. Default `${gl}:${language of hl}`, e.g. `US:en`. */
  ceid?: string;
  /** Custom fetch, e.g. with a proxy agent. Default `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  /** Per-request timeout. Default 30000. */
  timeoutMs?: number;
  /** Max decompressed bytes per response. Default 5000000. */
  maxBytes?: number;
}

export interface ResolveResult {
  /** Publisher article URL. */
  url: string;
  /** Google News article ID. */
  id: string;
  method: 'google-news-rpc' | 'http-redirect';
}

export interface ResolveManyOptions extends ResolveOptions {
  /** Parallel resolutions. Default 2. */
  concurrency?: number;
  /** Pause per worker between resolutions. Default 250. */
  delayMs?: number;
}

export type ResolveManyResult =
  | ({ input: string | URL; error?: undefined } & ResolveResult)
  | { input: string | URL; error: GoogleNewsResolveError | Error };

/** Resolve a news.google.com article URL (or bare article ID) to the publisher URL. */
export function resolveGoogleNews(input: string | URL, options?: ResolveOptions): Promise<ResolveResult>;

/** Resolve many URLs with limited concurrency. Never rejects; failures carry `error`. Order is preserved. */
export function resolveMany(inputs: Iterable<string | URL>, options?: ResolveManyOptions): Promise<ResolveManyResult[]>;

/** Extract the article ID from a Google News URL, or validate a bare ID. */
export function extractArticleId(input: string | URL): string;
