import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { extractArticleId, GoogleNewsResolveError, resolveGoogleNews, resolveMany } from '../src/index.js';

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const ID = 'CBMiswFBVV95cUxPMllaWmhCOFZkY0JVY2xvZElpb0pNeXZVQnl0aWpKeXNOekt6RFhPMWRFYzk2bmMtQk5MbVkzaENmTzhCZHFMbUZGT0JUejdidW9TSUxWQ0wtdC1odlR5UlhGRkNVVWJtTlBpb2VqbWtOeUxfZGxuZk5aeGI1TXhnb1dZYy1FaGNVWUR2MXo0NVFIMGMxM09ObHV5Q1NrTTk5Y0NzSXFMWlp2dk44Nml1cUIydw';
const URL_IN = `https://news.google.com/read/${ID}?hl=en-US&gl=US&ceid=US%3Aen`;
const REUTERS = 'https://www.reuters.com/world/china/chinas-factory-output-growth-quickens-in-august-retail-sales-slow-2026-09-15/';

function mockFetch(pageBody, rpcBody, calls = []) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(String(url).includes('batchexecute') ? rpcBody : pageBody);
  };
}

test('extractArticleId accepts read/articles/rss URLs and bare IDs', () => {
  for (const path of ['read', 'articles', 'rss/articles']) {
    assert.equal(extractArticleId(`https://news.google.com/${path}/${ID}`), ID);
  }
  assert.equal(extractArticleId(URL_IN), ID);
  assert.equal(extractArticleId(new URL(URL_IN)), ID);
  assert.equal(extractArticleId(ID), ID);
});

test('extractArticleId rejects other URLs', () => {
  for (const bad of ['', 'nope', `http://news.google.com/read/${ID}`, `https://example.com/read/${ID}`, 'https://news.google.com/home']) {
    assert.throws(() => extractArticleId(bad), { code: 'INVALID_INPUT' });
  }
});

test('resolves via signed RPC', async () => {
  const calls = [];
  const result = await resolveGoogleNews(URL_IN, { fetch: mockFetch(await fixture('rss.html'), await fixture('rpc.txt'), calls) });
  assert.deepEqual(result, { url: REUTERS, id: ID, method: 'google-news-rpc' });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/rss\/articles\/.+hl=en-US&gl=US&ceid=US%3Aen/);
  const fReq = JSON.parse(new URLSearchParams(String(calls[1].init.body)).get('f.req'));
  const args = JSON.parse(fReq[0][0][1]);
  assert.deepEqual([args[0], args[2], args[3], args[4]], ['garturlreq', ID, 1789731869, 'Ae5Wzi8ltJYXoWJDqniniWy6J93F']);
});

test('passes locale options through', async () => {
  const calls = [];
  await resolveGoogleNews(ID, { hl: 'nl', gl: 'NL', fetch: mockFetch(await fixture('rss.html'), await fixture('rpc.txt'), calls) });
  assert.match(calls[0].url, /hl=nl&gl=NL&ceid=NL%3Anl/);
});

test('NO_SIGNATURE when markup lacks attributes', async () => {
  await assert.rejects(
    resolveGoogleNews(ID, { fetch: mockFetch('<html></html>', '') }),
    err => err instanceof GoogleNewsResolveError && err.code === 'NO_SIGNATURE',
  );
});

test('RPC_EMPTY when RPC returns null', async () => {
  const empty = `)]}'\n\n[["wrb.fr","Fbv4je",null,null,null,[3],"generic"]]`;
  await assert.rejects(resolveGoogleNews(ID, { fetch: mockFetch(await fixture('rss.html'), empty) }), { code: 'RPC_EMPTY' });
});

test('RATE_LIMITED with retryAfter on 429', async () => {
  const fetch = async () => new Response('', { status: 429, headers: { 'retry-after': '30' } });
  await assert.rejects(resolveGoogleNews(ID, { fetch }), { code: 'RATE_LIMITED', status: 429, retryAfter: 30 });
});

test('HTTP_ERROR on other statuses', async () => {
  const fetch = async () => new Response('', { status: 503 });
  await assert.rejects(resolveGoogleNews(ID, { fetch }), { code: 'HTTP_ERROR', status: 503 });
});

test('RESPONSE_TOO_LARGE above maxBytes', async () => {
  await assert.rejects(resolveGoogleNews(ID, { maxBytes: 10, fetch: mockFetch('x'.repeat(100), '') }), { code: 'RESPONSE_TOO_LARGE' });
});

test('resolveMany keeps order and captures errors', async () => {
  const fetch = mockFetch(await fixture('rss.html'), await fixture('rpc.txt'));
  const results = await resolveMany([URL_IN, 'bad', ID], { fetch, delayMs: 0 });
  assert.equal(results.length, 3);
  assert.equal(results[0].url, REUTERS);
  assert.equal(results[1].error.code, 'INVALID_INPUT');
  assert.equal(results[2].url, REUTERS);
});

test('live resolution', { skip: !process.env.LIVE }, async () => {
  const result = await resolveGoogleNews(URL_IN);
  assert.equal(result.url, REUTERS);
});
