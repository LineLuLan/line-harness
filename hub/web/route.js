/* Intent: the Line Hub hash route as pure functions (no DOM), so tests can import it in Node.
 * Status: UI v6 (H8b adds #gates; model tier stays in component state, outside the hash).
 *   #<page>?days=N, or #models/<encodeURIComponent(key)>?days=N for a picked model.
 *   The page part is split on '/' before '?'; a bad percent-encoding drops the pick, never throws.
 *   'usage' is the old name of the 'cost' route. Unknown page -> 'overview'; unknown days -> 14.
 * Next: none. Blockers: none. Confidence: tests/route.test.js. */
export function hashParams(hash) { return new URLSearchParams(String(hash || '').replace(/^#/, '').split('?')[1] || ''); }

export function readRoute(hash, pageIds, dayList) {
  const [head, ...rest] = String(hash || '').replace(/^#/, '').split('?')[0].split('/');
  const page = head === 'usage' ? 'cost' : head; // the page was renamed; its route id stayed 'cost'
  const days = Number(hashParams(hash).get('days'));
  const known = pageIds.includes(page);
  let model = null;
  if (known && page === 'models' && rest.length) { try { model = decodeURIComponent(rest.join('/')) || null; } catch { model = null; } }
  return { page: known ? page : 'overview', days: dayList.includes(days) ? days : 14, model };
}

export const hashOf = (page, days, model = null) => `${page}${model ? `/${encodeURIComponent(model)}` : ''}?days=${days}`;
