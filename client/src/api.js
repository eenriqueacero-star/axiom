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

// Unauthenticated readiness flags (firebase / push / groq).
export async function getHealth() {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error('health check failed');
  return res.json();
}

// Per-key Groq probe (authenticated). ?force=1 skips the 60s server cache.
export const getKeyStatus = (force = false) =>
  request(`/status/groq-keys${force ? '?force=1' : ''}`);

export const getMarketNews = () => request('/signals/market');
export const getTickerNews = (ticker) => request(`/signals/${ticker.toUpperCase()}`);

export const getScorecard = () => request('/scorecard');

export const getPortfolio = () => request('/portfolio');
export const setHolding = (accountId, ticker, body) =>
  request(`/portfolio/${accountId}/${ticker.toUpperCase()}`, { method: 'PUT', body });
export const addTicker = (accountId, ticker) =>
  request(`/portfolio/${accountId}/${ticker.toUpperCase()}`, { method: 'POST' });
export const removeTicker = (accountId, ticker) =>
  request(`/portfolio/${accountId}/${ticker.toUpperCase()}`, { method: 'DELETE' });
export const importPositions = (accountId, text) =>
  request(`/portfolio/${accountId}/import`, { method: 'POST', body: { text } });
export const deleteAccount = (accountId) =>
  request(`/portfolio/${accountId}`, { method: 'DELETE' });
export const renameAccount = (accountId, nickname) =>
  request(`/portfolio/${accountId}`, { method: 'PATCH', body: { nickname } });

export const getBrokerStatus = () => request('/broker/status');
export const syncBroker = () => request('/broker/sync', { method: 'POST' });
