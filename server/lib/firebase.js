import { readFileSync } from 'fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const {
  FIREBASE_SERVICE_ACCOUNT,
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
} = process.env;

// Accept a full service-account JSON blob (FIREBASE_SERVICE_ACCOUNT) — either the
// JSON inline or a path to a file containing it (e.g. a Render secret file at
// /etc/secrets/...) — or the three fields split out individually.
function resolveCredential() {
  if (FIREBASE_SERVICE_ACCOUNT) {
    try {
      const raw = FIREBASE_SERVICE_ACCOUNT.trim().startsWith('{')
        ? FIREBASE_SERVICE_ACCOUNT
        : readFileSync(FIREBASE_SERVICE_ACCOUNT, 'utf8');
      const j = JSON.parse(raw);
      return {
        projectId:   j.project_id,
        clientEmail: j.client_email,
        privateKey:  j.private_key?.replace(/\\n/g, '\n'),
      };
    } catch (err) {
      console.error('[firebase] FIREBASE_SERVICE_ACCOUNT could not be loaded:', err.message);
      return null;
    }
  }
  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    return {
      projectId:   FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey:  FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }
  return null;
}

const credential = resolveCredential();
export const firebaseReady = Boolean(credential?.privateKey);

if (firebaseReady && !getApps().length) {
  initializeApp({ credential: cert(credential) });
} else if (!firebaseReady) {
  console.warn('[firebase] Admin credentials missing — auth and Firestore routes will 503 until env vars are set');
}

// Accessing Firestore before init throws; guard so module import never crashes the server.
export const db = firebaseReady ? getFirestore() : null;
