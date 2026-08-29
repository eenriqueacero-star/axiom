import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { callAgent, callSynthesis } from '../lib/groq.js';

const router = Router();
router.use(verifyToken);

router.post('/run', async (req, res) => {
  const { system, user, useSearch, maxTokens = 700, model, agentIndex = null } = req.body;
  if (!system || !user) return res.status(400).json({ error: 'Missing system or user' });
  if (system.length + user.length > 20000) return res.status(400).json({ error: 'Prompt too large' });

  try {
    if (model === 'openai/gpt-oss-120b' && !useSearch) {
      const text = await callSynthesis({ system, user, maxTokens: Math.max(maxTokens, 2000) });
      return res.json({ text });
    }
    const result = await callAgent({ system, user, useSearch: !!useSearch, maxTokens, agentIndex });
    res.json(result);
  } catch (err) {
    res.json({ text: '', warning: err.message });
  }
});

export default router;
