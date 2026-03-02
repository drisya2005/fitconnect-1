// firebase-init.js — shared Firebase init (fetches config from server, no hardcoded keys)
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js';

let _app, _auth, _db;

export async function initFirebase() {
    if (_app) return { app: _app, auth: _auth, db: _db };
    const cfg = await fetch('/api/firebase-config').then(r => r.json());
    _app = getApps().length ? getApps()[0] : initializeApp(cfg);
    _auth = getAuth(_app);
    _db = getFirestore(_app);
    return { app: _app, auth: _auth, db: _db };
}

export async function getIdToken() {
    const { auth } = await initFirebase();
    if (!auth.currentUser) return null;
    return auth.currentUser.getIdToken();
}

export async function fetchWithAuth(url, opts = {}) {
    const token = await getIdToken();
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(url, { ...opts, headers });
}

export async function doSignOut() {
    const { auth } = await initFirebase();
    const { signOut } = await import('https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js');
    await signOut(auth);
}
