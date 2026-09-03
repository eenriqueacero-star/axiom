import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { AuthProvider } from './AuthProvider';
import { navlog } from './lib/navdebug';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);

if ('serviceWorker' in navigator) {
  navlog('page load');
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      navlog(`sw registered (active: ${reg.active ? 'yes' : 'no'})`);

      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        navlog('sw update found');
        nw.addEventListener('statechange', () => {
          navlog(`sw state → ${nw.state}`);
          if (nw.state === 'activated' && navigator.serviceWorker.controller) {
            if (!sessionStorage.getItem('axiom-reloaded')) {
              sessionStorage.setItem('axiom-reloaded', '1');
              navlog('reloading for new sw');
              location.reload();
            }
          }
        });
      });
    } catch (e) { navlog(`sw register failed: ${e.message}`); }
  });

  navigator.serviceWorker.addEventListener('message', (e) => {
    navlog(`sw message: ${e.data?.type || '?'}`);
    if (e.data?.type === 'axiom-sw-updated' && !sessionStorage.getItem('axiom-reloaded')) {
      sessionStorage.setItem('axiom-reloaded', '1');
      location.reload();
    }
  });
  window.addEventListener('load', () => setTimeout(() => sessionStorage.removeItem('axiom-reloaded'), 5000));
}
