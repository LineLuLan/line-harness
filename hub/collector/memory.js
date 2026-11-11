/* Intent: capture resident-memory peaks and their JS/external breakdown locally.
 * Status: r2 resident and ArrayBuffer high-water samples, no memory flags.
 * Next: compare samples with OS high-water RSS. Blockers: none.
 * Confidence: samples are labelled; OS peaks between samples remain distinguishable. */
'use strict';
function memorySampler() {
  let peak, arrayBuffersPeak = 0;
  function sample(phase) {
    const usage = process.memoryUsage();
    if (!peak || usage.rss > peak.rss) peak = { phase, ...usage };
    arrayBuffersPeak = Math.max(arrayBuffersPeak, usage.arrayBuffers);
  }
  sample('startup');
  return { sample, report: () => ({ sampled_peak: peak, sampled_array_buffers_peak: arrayBuffersPeak,
    max_rss_kb: process.resourceUsage().maxRSS }) };
}
module.exports = { memorySampler };
