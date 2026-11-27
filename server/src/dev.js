// Owner-only dev mode. The allow-list is a server env secret (DEV_ACCOUNT_ID), never a display name.
// LOCAL_DEV only: tests can grant the current account via POST /_test/grant-dev.
import { safeEqual } from './util.js';

const testAids = new Set();

export function grantTestDev(aid) {
  if (typeof aid === 'string' && aid) testAids.add(aid);
}

export function devAllowed(env, aid) {
  if (!env || typeof aid !== 'string' || !aid) return false;
  const raw = String(env.DEV_ACCOUNT_ID || '');
  for (const id of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (id.length === aid.length && safeEqual(id, aid)) return true;
  }
  return env.LOCAL_DEV === '1' && testAids.has(aid);
}
