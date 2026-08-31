# Axiom Backlog

Deferred work, not yet scheduled.

## Notification system rework
- Current: Web Push (VAPID) via `web-push`, subscription stored at `users/{uid}/push/subscription`.
- Problem: delivery is unreliable — notifications don't always arrive.
- Likely causes to investigate: expired/stale subscriptions not being pruned, service worker
  lifecycle on mobile, single-subscription-per-user model, no delivery retry or logging,
  iOS PWA push constraints.
- Goal: reliable alerts for the daily scout scan and portfolio alerts.
