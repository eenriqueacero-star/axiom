import { startHeartbeat } from './heartbeat.js';

// All scheduled work runs through jobs/heartbeat.js — it fires each job when
// it's overdue (last-run time in Firestore), so nothing is lost when Render's
// free tier sleeps the process. A 60s interval keeps it prompt while awake; the
// /health and /tick endpoints drive it while the service would otherwise sleep
// (point an external uptime pinger at /tick every few minutes).
export function initScheduler() {
  startHeartbeat();
}
