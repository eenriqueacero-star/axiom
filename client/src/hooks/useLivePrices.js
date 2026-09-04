import { useEffect, useRef, useState } from 'react';
import { getQuotes } from '../api';

/**
 * Polls live quotes for a ticker set every few seconds. The backend caches
 * each unique ticker-set for 45s, so polling faster than that costs nothing
 * extra against Finnhub's rate limit — it just means a snappier UI between
 * cache refreshes. Pauses while the tab is hidden.
 */
export function useLivePrices(tickers, intervalMs = 8000) {
  const [quotes, setQuotes] = useState({});
  const key = tickers.join(',');
  const listRef = useRef(tickers);
  listRef.current = tickers;

  useEffect(() => {
    if (!listRef.current.length) return;
    let alive = true;
    let timer = null;

    const tick = async () => {
      if (!document.hidden) {
        try {
          const r = await getQuotes(listRef.current);
          if (alive) setQuotes(r);
        } catch { /* keep last known quotes */ }
      }
      if (alive) timer = setTimeout(tick, intervalMs);
    };

    tick();
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [key, intervalMs]);

  return quotes;
}
