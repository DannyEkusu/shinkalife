// The single data-access boundary. Pages talk to the service, the service talks to repo. There is NO automatic fallback:
// if the real database fails, the error surfaces. The mock is only active when explicitly chosen (see repo-mock.js).
let current = null, kind = 'none';
export const setRepo = (r, k) => { current = r; kind = k; };
export const repoKind = () => kind;
export const repo = new Proxy({}, { get: (_, k) => { if (!current) throw new Error('No data source is active. Log in first.'); return current[k]; } });
