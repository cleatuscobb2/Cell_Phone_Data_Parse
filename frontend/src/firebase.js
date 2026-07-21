/**
 * Firebase initialization for the sign-in gate and large-upload pipeline.
 *
 * Auth is enabled only when the VITE_FIREBASE_* config is present. Local
 * development against the localhost FastAPI backend can leave it blank and
 * the app runs with no sign-in gate (see AuthGate.jsx) and no Storage uploads.
 *
 * The values below are the Firebase *web* config — they are not secret and
 * are meant to ship in the client bundle.
 */

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import {
  getStorage,
  ref,
  uploadBytesResumable,
  deleteObject,
} from "firebase/storage";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
};

export const authEnabled = Boolean(
  config.apiKey && config.authDomain && config.projectId,
);

const app = authEnabled ? initializeApp(config) : null;
export const auth = app ? getAuth(app) : null;
export const googleProvider = authEnabled ? new GoogleAuthProvider() : null;

// Storage is available only when a bucket is configured (i.e. production).
// When absent, the app falls back to sending files directly in the request.
const storage = app && config.storageBucket ? getStorage(app) : null;
export const storageEnabled = Boolean(storage);

/**
 * The current user's Firebase ID token, or null when auth is disabled or no
 * one is signed in. Fetched fresh each call so it is never stale.
 */
export async function getIdToken() {
  if (!auth || !auth.currentUser) return null;
  return auth.currentUser.getIdToken();
}

/** The signed-in user's uid, or null. Used to scope Storage upload paths. */
export function currentUid() {
  return auth?.currentUser?.uid || null;
}

/**
 * Upload a File to Cloud Storage at `path`, reporting progress. Resumable, so
 * it bypasses the 32 MB request limit that direct multipart uploads hit.
 * Resolves to `path`.
 */
export function uploadToStorage(file, path, onProgress) {
  return new Promise((resolve, reject) => {
    if (!storage) {
      reject(new Error("Storage is not configured for this deployment."));
      return;
    }
    const task = uploadBytesResumable(ref(storage, path), file);
    task.on(
      "state_changed",
      (snap) => {
        if (onProgress) onProgress(snap.bytesTransferred, snap.totalBytes);
      },
      reject,
      () => resolve(path),
    );
  });
}

/** Best-effort delete of Storage objects (e.g. when the file set changes). */
export async function deleteFromStorage(paths) {
  if (!storage || !paths?.length) return;
  await Promise.allSettled(paths.map((p) => deleteObject(ref(storage, p))));
}
