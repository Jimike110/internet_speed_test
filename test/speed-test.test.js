'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { formatBytes, getUrl, runSpeedTest } = require('../speed-test');

async function createTestServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    server,
    url: new URL(`http://127.0.0.1:${port}/file`),
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test('formatBytes formats binary byte units', () => {
  assert.equal(formatBytes(500), '500.00 Б');
  assert.equal(formatBytes(1024), '1.00 КиБ');
  assert.equal(formatBytes(1024 ** 2), '1.00 МиБ');
});

test('getUrl waits for the complete response and counts received bytes', async (t) => {
  const fixture = await createTestServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.write('hello');
    setTimeout(() => response.end(' world'), 20);
  });
  t.after(fixture.close);

  const result = await getUrl(fixture.url);

  assert.equal(result.bytes, Buffer.byteLength('hello world'));
  assert.ok(result.durationMs >= 15, `expected full-response time, got ${result.durationMs} ms`);
});

test('runSpeedTest performs requests sequentially and aggregates their results', async (t) => {
  let activeRequests = 0;
  let maximumConcurrentRequests = 0;
  let requestCount = 0;
  const responseBody = 'test payload';
  const fixture = await createTestServer((request, response) => {
    requestCount += 1;
    activeRequests += 1;
    maximumConcurrentRequests = Math.max(maximumConcurrentRequests, activeRequests);

    setTimeout(() => {
      response.end(responseBody);
      activeRequests -= 1;
    }, 15);
  });
  t.after(fixture.close);

  const messages = [];
  const result = await runSpeedTest(fixture.url, 3, (message) => messages.push(message));

  assert.equal(requestCount, 3);
  assert.equal(maximumConcurrentRequests, 1);
  assert.equal(result.totalBytes, 3 * Buffer.byteLength(responseBody));
  assert.ok(result.averageMs >= 10);
  assert.ok(result.speedBytesPerSecond > 0);
  assert.ok(messages.some((message) => message.includes('Средняя скорость скачивания')));
});

test('getUrl follows HTTP redirects', async (t) => {
  const fixture = await createTestServer((request, response) => {
    if (request.url === '/file') {
      response.writeHead(302, { location: '/target' });
      response.end();
      return;
    }

    response.end('redirected body');
  });
  t.after(fixture.close);

  const result = await getUrl(fixture.url);
  assert.equal(result.bytes, Buffer.byteLength('redirected body'));
});
