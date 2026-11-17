#!/usr/bin/env node

'use strict';

const http = require('node:http');
const https = require('node:https');
const { performance } = require('node:perf_hooks');

const REQUEST_COUNT = 10;
const MAX_REDIRECTS = 5;

function printUsage() {
  console.error('Использование: node speed-test.js <URL>');
  console.error('Пример: node speed-test.js https://example.com/large-image.jpg');
}

function formatBytes(bytes) {
  const units = ['Б', 'КиБ', 'МиБ', 'ГиБ'];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(2)} ${units[unit]}`;
}

function getUrl(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const startedAt = performance.now();

    const request = client.get(url, (response) => {
      const statusCode = response.statusCode ?? 0;
      const location = response.headers.location;

      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();

        if (redirectsLeft === 0) {
          reject(new Error('Превышено число перенаправлений'));
          return;
        }

        resolve(getUrl(new URL(location, url), redirectsLeft - 1));
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Сервер вернул HTTP ${statusCode}`));
        return;
      }

      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
      });
      response.on('end', () => {
        resolve({ bytes, durationMs: performance.now() - startedAt });
      });
      response.on('error', reject);
    });

    request.setTimeout(30_000, () => {
      request.destroy(new Error('Тайм-аут запроса (30 с)'));
    });
    request.on('error', reject);
  });
}

async function runSpeedTest(url, requestCount = REQUEST_COUNT, log = console.log) {
  let totalBytes = 0;
  let totalDurationMs = 0;

  log(`Выполняю ${requestCount} последовательных запросов к ${url.href}`);

  for (let index = 1; index <= requestCount; index += 1) {
    const result = await getUrl(url);
    totalBytes += result.bytes;
    totalDurationMs += result.durationMs;
    log(`${index}/${requestCount}: ${result.durationMs.toFixed(0)} мс, ${formatBytes(result.bytes)}`);
  }

  const averageMs = totalDurationMs / requestCount;
  const speedBytesPerSecond = totalBytes / (totalDurationMs / 1000);

  log('\nРезультат:');
  log(`Среднее время запроса: ${averageMs.toFixed(2)} мс`);
  log(`Всего скачано: ${formatBytes(totalBytes)} (${totalBytes} Б)`);
  log(`Средняя скорость скачивания: ${formatBytes(speedBytesPerSecond)}/с`);

  return { totalBytes, totalDurationMs, averageMs, speedBytesPerSecond };
}

async function main() {
  const address = process.argv[2];
  if (!address) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  let url;
  try {
    url = new URL(address);
  } catch {
    console.error('Некорректный URL. Укажите полный адрес, например https://example.com/file.jpg');
    process.exitCode = 1;
    return;
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    console.error('Поддерживаются только адреса http:// и https://');
    process.exitCode = 1;
    return;
  }

  await runSpeedTest(url);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Ошибка: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { formatBytes, getUrl, runSpeedTest };
