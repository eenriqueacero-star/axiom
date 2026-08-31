import express from 'express';
import cors from 'cors';
import { initScheduler } from './jobs/scheduler.js';
import { firebaseReady } from './lib/firebase.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '2mb' }));

// Routes
const { default: agentRoute }  = await import('./routes/agent.js');
const { default: quotesRoute } = await import('./routes/quotes.js');
const { default: newsRoute }   = await import('./routes/news.js');
const { default: pushRoute }   = await import('./routes/push.js');
const { default: rulingRoute } = await import('./routes/rulings.js');

app.use('/api/agent',   agentRoute);
app.use('/api/quotes',  quotesRoute);
app.use('/api/news',    newsRoute);
app.use('/api/push',    pushRoute);
app.use('/api/rulings', rulingRoute);

app.get('/health', (_, res) => res.json({
  ok: true,
  ts: Date.now(),
  firebase: firebaseReady,
  push: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
  groq: Boolean(process.env.GROQ_API_KEY),
}));

// Global error handler — never leak a stack trace, never crash the process.
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Internal error' });
});

process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));

app.listen(PORT, () => {
  console.log(`Axiom server running on :${PORT}`);
  initScheduler();
});
