import test from 'node:test';
import assert from 'node:assert';
import { maskUrl, sanitizePath, validateUrl } from '../../src/engine/security/url-validator';
import { Semaphore, withRetry } from '../../src/engine/utils/concurrency';

test('Security - SSRF Protection on Cloud Metadata IPs', () => {
  // Always forbidden: cloud metadata service (AWS/GCP/Azure)
  assert.throws(
    () => validateUrl('http://169.254.169.254/latest/meta-data/'),
    /SSRF Block/,
  );

  assert.throws(
    () => validateUrl('http://metadata.google.internal/computeMetadata/v1/'),
    /SSRF Block/,
  );
});

test('Security - Path Traversal Protection', () => {
  assert.throws(
    () => sanitizePath('../../etc/passwd'),
    /Path traversal attempt detected/,
  );

  assert.throws(
    () => sanitizePath('movies/%2e%2e/secret/data'),
    /Path traversal attempt detected/,
  );

  assert.throws(
    () => sanitizePath('movies/..\\system32'),
    /Path traversal attempt detected/,
  );

  // Clean paths normalize safely
  assert.strictEqual(sanitizePath('movies/action/dune/'), 'movies/action/dune/');
  assert.strictEqual(sanitizePath('/movies//action/'), 'movies/action/');
});

test('Security - Secret Redaction in URLs and Credentials', () => {
  const masked1 = maskUrl('http://admin:supersecretpassword@192.168.1.100/movies');
  assert.strictEqual(masked1, 'http://admin:***@192.168.1.100/movies');
  assert.strictEqual(masked1.includes('supersecretpassword'), false);

  const masked2 = maskUrl('ftp://bdix_user:p@ssword123@ftp.bdix.local/media');
  assert.strictEqual(masked2.includes('p@ssword123'), false);
  assert.ok(masked2.includes('***'));
});

test('Concurrency - Semaphore Limits Parallel Tasks', async () => {
  const sem = new Semaphore(2);
  let active = 0;
  let maxSeen = 0;

  const task = async () => {
    return sem.run(async () => {
      active++;
      if (active > maxSeen) maxSeen = active;
      await new Promise((r) => setTimeout(r, 20));
      active--;
    });
  };

  await Promise.all([task(), task(), task(), task(), task()]);

  assert.strictEqual(maxSeen, 2); // Never exceeded concurrency limit of 2!
});

test('Concurrency - Retry with Exponential Backoff', async () => {
  let attempts = 0;
  const result = await withRetry(
    async (att) => {
      attempts = att;
      if (att < 3) {
        throw new Error('Transient error');
      }
      return 'success';
    },
    { maxAttempts: 4, initialDelayMs: 10, backoffFactor: 1.5 },
  );

  assert.strictEqual(result, 'success');
  assert.strictEqual(attempts, 3);
});
