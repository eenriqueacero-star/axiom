import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

export const firebaseReady = Boolean(
  FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY,
);

if (firebaseReady && !getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey:  FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
} else if (!firebaseReady) {
  console.warn('[firebase] Admin credentials missing — auth and Firestore routes will 503 until env vars are set');
}

// Accessing Firestore before init throws; guard so module import never crashes the server.
export const db = firebaseReady ? getFirestore() : null;
