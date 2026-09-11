export function summarize(samples) {
  if (!samples.length || samples.some(value => !Number.isFinite(value) || value < 0)) throw new Error("Incomplete timing samples");
  const ordered = [...samples].sort((a, b) => a - b);
  return { count: samples.length, min: ordered[0], max: ordered.at(-1), p95: ordered[Math.ceil(ordered.length * 0.95) - 1] };
}

export function matchesZoom(metrics, width, factor) {
  return Math.abs(metrics.ratio - factor) < 0.01 && Math.abs(metrics.width - width / factor) <= 1 && Math.abs(metrics.scale - 1) < 0.01;
}
