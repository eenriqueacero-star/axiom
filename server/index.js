import express from 'express';
import cors from 'cors';
import { initScheduler } from './jobs/scheduler.js';

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

app.get('/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

app.listen(PORT, () => {
  console.log(`Axiom server running on :${PORT}`);
  initScheduler();
});
