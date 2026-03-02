// Firebase v9 modular SDK via CDN imports
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js';

// TODO: replace with your Firebase project config
const firebaseConfig = {
  apiKey: "AIzaSyD8SAy-L0vtNsyqU6421yH_5CBpnoAvDXQ",
    authDomain: "fitconnect-c0e09.firebaseapp.com",
    projectId: "fitconnect-c0e09",
  // other fields if present
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const registerForm = document.getElementById('registerForm');
const loginForm = document.getElementById('loginForm');
const regMsg = document.getElementById('regMsg');
const loginMsg = document.getElementById('loginMsg');

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  regMsg.textContent = '';
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    regMsg.textContent = 'Registered — signing in...';
    // Immediately redirect to home page after successful registration
    window.location.href = '/home.html';
  } catch (err) {
    regMsg.textContent = err.message;
  }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginMsg.textContent = '';
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    loginMsg.textContent = 'Logged in — redirecting...';
    // Immediately redirect to home page after successful login
    window.location.href = '/home.html';
  } catch (err) {
    loginMsg.textContent = err.message;
  }
});

// Only redirect to the home page automatically when the user
// is currently on the login/register page. This avoids redirect loops
// if the user is already on the home or other pages.
onAuthStateChanged(auth, (user) => {
  const path = window.location.pathname;
  const onLoginPage = path === '/' || path.endsWith('/index.html');
  if (user && onLoginPage) {
    window.location.href = '/home.html';
  }
});

// Export signOut helper for protected page
export async function doSignOut() {
  await signOut(auth);
}

// Return current user's ID token (or null)
export async function getIdToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return await user.getIdToken();
}

// Convenience fetch wrapper that attaches the Firebase ID token
export async function fetchWithAuth(url, opts = {}) {
  const token = await getIdToken();
  const headers = Object.assign({}, opts.headers || {});
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, Object.assign({}, opts, { headers }));
  return res;
}
