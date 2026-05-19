/**
 * AuthGate — wraps the app in a Firebase sign-in gate.
 *
 * When Firebase is not configured (no VITE_FIREBASE_* env vars), the gate is
 * inert and children render directly — this keeps local development against
 * the localhost backend friction-free. When Firebase IS configured, the user
 * must sign in with Google before the app is shown.
 */

import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider, authEnabled } from "./firebase.js";

function Centered({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      {children}
    </div>
  );
}

function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSignIn() {
    setBusy(true);
    setError("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(err?.message || "Sign-in failed. Please try again.");
      setBusy(false);
    }
  }

  return (
    <Centered>
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-slate-800">
          Message History Summarizer
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Sign in to analyze your text and email history. Your data is sent
          only to your own backend for processing and is not stored.
        </p>
        <button
          onClick={handleSignIn}
          disabled={busy}
          className="mt-6 w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in with Google"}
        </button>
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      </div>
    </Centered>
  );
}

function SignedInBar({ user }) {
  return (
    <div className="flex items-center justify-end gap-3 border-b border-slate-200 bg-white px-6 py-2 text-xs">
      <span className="text-slate-500">
        Signed in as <span className="font-medium text-slate-700">{user.email}</span>
      </span>
      <button
        onClick={() => signOut(auth)}
        className="rounded-md border border-slate-300 px-2.5 py-1 font-medium text-slate-600 transition hover:bg-slate-50"
      >
        Sign out
      </button>
    </div>
  );
}

export default function AuthGate({ children }) {
  // `undefined` = still resolving, `null` = signed out, object = signed in.
  const [user, setUser] = useState(authEnabled ? undefined : null);

  useEffect(() => {
    if (!authEnabled) return undefined;
    return onAuthStateChanged(auth, (u) => setUser(u ?? null));
  }, []);

  if (!authEnabled) return children;

  if (user === undefined) {
    return (
      <Centered>
        <p className="text-sm text-slate-400">Checking sign-in…</p>
      </Centered>
    );
  }

  if (!user) return <SignIn />;

  return (
    <>
      <SignedInBar user={user} />
      {children}
    </>
  );
}
