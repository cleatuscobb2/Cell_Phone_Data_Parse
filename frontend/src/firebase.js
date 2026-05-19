/**
 * Firebase initialization for the sign-in gate.
 *
 * Auth is enabled only when the VITE_FIREBASE_* config is present. Local
 * development against the localhost FastAPI backend can leave it blank and
 * the app runs with no sign-in gate (see AuthGate.jsx).
 *
 * The values below are the Firebase *web* config — they are not secret and
 * are meant to ship in the client bundle.
 */

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const authEnabled = Boolean(
  config.apiKey && config.authDomain && config.projectId,
);

export const auth = authEnabled ? getAuth(initializeApp(config)) : null;
export const googleProvider = authEnabled ? new GoogleAuthProvider() : null;

/**
 * The current user's Firebase ID token, or null when auth is disabled or no
 * one is signed in. Fetched fresh each call so it is never stale.
 */
export async function getIdToken() {
  if (!auth || !auth.currentUser) return null;
  return auth.currentUser.getIdToken();
}
