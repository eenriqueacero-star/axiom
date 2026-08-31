import { auth } from './firebase';

const BASE = import.meta.env.VITE_API_BASE || '';

async function request(path, { method = 'GET', body } = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const token = await user.getIdToken();

  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

// Agent metadata is unauthenticated.
export async function getAgents() {
  const res = await fetch(`${BASE}/api/council/agents`);
  if (!res.ok) throw new Error('Failed to load agents');
  return res.json();
}

export const runCouncil = (ticker, force = false) =>
  request('/council/run', { method: 'POST', body: { ticker, force } });
