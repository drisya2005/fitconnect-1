FitConnect — Node + Firebase Auth (Email/Password)

Setup

1. Create a Firebase project at https://console.firebase.google.com
2. Enable Authentication > Sign-in method > Email/Password
3. In Project settings > General, copy the Firebase config (apiKey, authDomain, projectId, etc.)
4. Replace the placeholders `REPLACE_WITH_API_KEY`, `REPLACE_WITH_PROJECT`, and `REPLACE_WITH_PROJECT_ID` in `public/app.js` and `public/protected.html` with your config values.

Local run

```bash
npm install
npm start
```

Open http://localhost:3000 in your browser.

Notes

- This example uses the Firebase Web SDK in the frontend to handle registration and login.
- If you want server-side session management or token verification, add the Firebase Admin SDK to `server.js` and provide a service account key; I can help add that next.
