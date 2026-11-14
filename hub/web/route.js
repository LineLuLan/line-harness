/* Intent: the Line Hub hash route as pure functions (no DOM), so tests can import it in Node.
 * Status: six pages. Old work pages -> work; system/harness -> machine; models[/key]/usage -> cost.
 *   #<page>?days=N; legacy model keys are ignored, including malformed percent-encoding.
 *   Unknown page -> overview; unknown days -> 14. Next: none. Blockers: none.
 * Confidence: tests/route.test.js and tests/hub-slim.test.js. */
export function hashParams(hash) { return new URLSearchParams(String(hash || '').replace(/^#/, '').split('?')[1] || ''); }

export function readRoute(hash, pageIds, dayList) {
  const head = String(hash || '').replace(/^#/, '').split('?')[0].split('/')[0];
  const aliases = { supervisor: 'work', workers: 'work', gates: 'work', productivity: 'work', system: 'machine', harness: 'machine', models: 'cost', usage: 'cost' };
  const page = Object.hasOwn(aliases, head) ? aliases[head] : head;
  const days = Number(hashParams(hash).get('days'));
  const known = pageIds.includes(page);
  return { page: known ? page : 'overview', days: dayList.includes(days) ? days : 14, model: null };
}

export const hashOf = (page, days, model = null) => `${page}${model ? `/${encodeURIComponent(model)}` : ''}?days=${days}`;
