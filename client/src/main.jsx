import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { AuthProvider } from './AuthProvider';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');

      // A new worker installed while the app is open → reload once to get the
      // fresh bundle (iOS PWAs won't do this on their own).
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'activated' && navigator.serviceWorker.controller) {
            if (!sessionStorage.getItem('axiom-reloaded')) {
              sessionStorage.setItem('axiom-reloaded', '1');
              location.reload();
            }
          }
        });
      });
    } catch { /* non-fatal */ }
  });

  // The worker asks for a reload after it takes over.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'axiom-sw-updated' && !sessionStorage.getItem('axiom-reloaded')) {
      sessionStorage.setItem('axiom-reloaded', '1');
      location.reload();
    }
  });
  // Clear the guard once we're stable so a later update can reload again.
  window.addEventListener('load', () => setTimeout(() => sessionStorage.removeItem('axiom-reloaded'), 5000));
}
