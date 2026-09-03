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

// Scheduled-job health — running / failing / overdue + last error.
export const getJobs = () => request('/status/jobs');

// Notifications feed + preferences.
export const getNotifications = (limit = 50) => request(`/notifications?limit=${limit}`);
export const markNotificationsRead = (ids) => request('/notifications/read', { method: 'POST', body: { ids: ids ?? null } });
export const getNotifyPrefs = () => request('/notifications/prefs');
export const setNotifyPrefs = (prefs) => request('/notifications/prefs', { method: 'PUT', body: prefs });

export const getMarketNews = () => request('/signals/market');
export const getTickerNews = (ticker) => request(`/signals/${ticker.toUpperCase()}`);
export const getHoldingsSignals = () => request('/signals/holdings');

export const getCongress = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  return request(`/congress${q ? `?${q}` : ''}`);
};

export const getScorecard = () => request('/scorecard');

// Push notifications
export async function getVapidPublic() {
  const res = await fetch(`${BASE}/api/push/vapid-public`);
  if (!res.ok) throw new Error('Push not configured');
  return res.json();
}
export const subscribePush = (subscription) =>
  request('/push/subscribe', { method: 'POST', body: { subscription } });
export const unsubscribePush = (endpoint) =>
  request('/push/unsubscribe', { method: 'POST', body: { endpoint } });
export const getPushStatus = () => request('/push/status');
export const sendTestPush = () => request('/push/test', { method: 'POST', body: {} });
export const getBacktest = () => request('/quant/backtest');
export const getQuantStatus = () => request('/quant/status');
export const getQuantHoldings = () => request('/quant/holdings-now');

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

export const getContributions = () => request('/strategy/contributions');
export const setContributions = (body) => request('/strategy/contributions', { method: 'PUT', body });
export const addContributionEntry = (body) => request('/strategy/contributions/entry', { method: 'POST', body });
export const removeContributionEntry = (id) => request(`/strategy/contributions/entry/${id}`, { method: 'DELETE' });

export const getStances = () => request('/council/stances');
export const reviewHoldings = (force = false) =>
  request('/council/review', { method: 'POST', body: { force } });
export const getLatestAnalysis = (ticker) =>
  request(`/council/analysis/${ticker.toUpperCase()}`);
export const getFloor = () => request('/council/floor');
export const getAgentWeights = () => request('/council/agent-weights');
export const getCalibration = () => request('/council/calibration');
export const getFloorLive = () => request('/council/floor/live');

// The desk — agent-to-agent conversations and the notes they leave behind.
export const getDeskState = () => request('/desk/state');
export const getDeskNotes = () => request('/desk/notes');
export const getDeskWork = () => request('/desk/work');
export const getPlaybooks = () => request('/desk/playbooks');
export const runDeskNight = () => request('/desk/run-night', { method: 'POST', body: {} });
export const getDeskNext = () => request('/desk/next');
export const getDeskBudget = () => request('/desk/budget');
export const convene = () => request('/desk/convene', { method: 'POST', body: {} });

// Event desk + private boss chat
export const getDeskEvents = () => request('/desk/events');
export const getOpportunities = () => request('/desk/opportunities');
export const getVault = () => request('/desk/vault');
export const getBossThreads = () => request('/desk/chats');
export const getBossThread = (id) => request(`/desk/chats/${id}`);
export const newBossThread = (title) => request('/desk/chats', { method: 'POST', body: { title: title || 'Boss' } });
export const sendBossMessage = (id, text) => request(`/desk/chats/${id}/message`, { method: 'POST', body: { text } });
export const resolveBossThread = (id, outcome) => request(`/desk/chats/${id}/resolve`, { method: 'POST', body: { outcome } });
export const startExecution = (ticker) => request('/desk/execute', { method: 'POST', body: { ticker } });
export const chatAgent = (id, messages, ticker) =>
  request(`/council/agent/${id}/chat`, { method: 'POST', body: { messages, ticker } });
export const getDca = () => request('/strategy/dca');

export const getStrategyDiagnostics = () => request('/strategy/diagnostics');
export const getStrategyConfig = () => request('/strategy');

export const getBrokerStatus = () => request('/broker/status');
export const syncBroker = () => request('/broker/sync', { method: 'POST' });
