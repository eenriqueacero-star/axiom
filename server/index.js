import express from 'express';
import cors from 'cors';
import { initScheduler } from './jobs/scheduler.js';
import { firebaseReady } from './lib/firebase.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Allow the deployed client(s) plus local dev. CLIENT_URL may be comma-separated.
const allowedOrigins = [
  ...(process.env.CLIENT_URL?.split(',').map(s => s.trim()).filter(Boolean) || []),
  'http://localhost:5173',
];
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(null, false);
  },
}));
app.use(express.json({ limit: '2mb' }));

// Routes
const { default: agentRoute }   = await import('./routes/agent.js');
const { default: councilRoute } = await import('./routes/council.js');
const { default: quotesRoute }  = await import('./routes/quotes.js');
const { default: newsRoute }    = await import('./routes/news.js');
const { default: pushRoute }    = await import('./routes/push.js');
const { default: rulingRoute }  = await import('./routes/rulings.js');
const { default: statusRoute }  = await import('./routes/status.js');
const { default: signalsRoute } = await import('./routes/signals.js');
const { default: portfolioRoute } = await import('./routes/portfolio.js');
const { default: scorecardRoute } = await import('./routes/scorecard.js');
const { default: brokerRoute }    = await import('./routes/broker.js');

app.use('/api/agent',   agentRoute);
app.use('/api/council', councilRoute);
app.use('/api/quotes',  quotesRoute);
app.use('/api/news',    newsRoute);
app.use('/api/push',    pushRoute);
app.use('/api/rulings', rulingRoute);
app.use('/api/status',  statusRoute);
app.use('/api/signals', signalsRoute);
app.use('/api/portfolio', portfolioRoute);
app.use('/api/scorecard', scorecardRoute);
app.use('/api/broker',    brokerRoute);

app.get('/health', (_, res) => res.json({
  ok: true,
  ts: Date.now(),
  firebase: firebaseReady,
  push: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
  groq: Boolean(process.env.GROQ_API_KEY),
  broker: Boolean(process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY),
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
