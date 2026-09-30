async function request(path, options = {}) {
  const res = await fetch(path, options);
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) {
    const err = new Error(`Request to ${path} failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const api = {
  health: () => request('/health'),
  performance: () => request('/performance'),
  examples: () => request('/example-patients'),
  globalImportance: () => request('/global-importance'),
  operatingCurves: () => request('/operating-curves'),
  predict: (payload, signal) => request('/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  }),
};
