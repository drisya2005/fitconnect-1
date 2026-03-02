require('dotenv').config();
const express = require('express');
const path = require('path');
const admin = require('firebase-admin');
const fs = require('fs');

// ── Firebase Admin Init ────────────────────────────────────────────────────────
if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
  try {
    const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8'));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log('[FitConnect] Firebase Admin initialized using env var');
  } catch (err) {
    console.error('[FitConnect] Failed to parse service account from env:', err.message);
    admin.initializeApp();
  }
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  admin.initializeApp();
} else {
  const keyPath = process.env.SERVICE_ACCOUNT_PATH
    ? path.resolve(__dirname, process.env.SERVICE_ACCOUNT_PATH)
    : path.join(__dirname, 'serviceAccountKey.json');
  if (fs.existsSync(keyPath)) {
    admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
  } else {
    console.warn('[FitConnect] No service account found – admin features will fail.');
    try { admin.initializeApp(); } catch (_) { }
  }
}

const db = admin.firestore();
const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Firebase client config (keeps keys out of frontend HTML) ──────────────────
app.get('/api/firebase-config', (_req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID,
  });
});

// ── Auth middleware ────────────────────────────────────────────────────────────
async function authenticate(req, res, next) {
  const match = (req.header('Authorization') || '').match(/^Bearer (.+)$/);
  if (!match) return res.status(401).json({ error: 'Missing Authorization header' });
  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid ID token', details: err.message });
  }
}

// ── Admin check middleware ─────────────────────────────────────────────────────
async function requireAdmin(req, res, next) {
  await authenticate(req, res, async () => {
    const userDoc = await db.collection('users').doc(req.uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// POST /register — Create user record in Firestore after Firebase Auth signup
app.post('/register', authenticate, async (req, res) => {
  const { displayName } = req.body;
  try {
    const existing = await db.collection('users').doc(req.uid).get();
    if (!existing.exists) {
      await db.collection('users').doc(req.uid).set({
        uid: req.uid,
        displayName: displayName || '',
        role: 'user',
        createdAt: admin.firestore.Timestamp.now(),
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /login — Verify token and return user data
app.post('/login', authenticate, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    res.json({ ok: true, uid: req.uid, user: userData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /logout — Client-side (Firebase signOut) but server can clear sessions etc.
app.post('/logout', authenticate, (_req, res) => {
  res.json({ ok: true, message: 'Signed out successfully' });
});

// POST /forgot-password — Handled entirely by Firebase Auth on client side
app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  // Firebase client SDK handles the actual email; here we just acknowledge
  res.json({ ok: true, message: 'Password reset email initiated from client SDK' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DASHBOARD & PROFILE
// ═══════════════════════════════════════════════════════════════════════════════

// GET /dashboard — Aggregated user data
app.get('/dashboard', authenticate, async (req, res) => {
  const uid = req.uid;
  try {
    const [membSnap, usageSnap, workoutsSnap, bmiSnap, userSnap] = await Promise.all([
      db.collection('memberships').where('userId', '==', uid).get(),
      db.collection('usageLogs').where('userId', '==', uid).orderBy('createdAt', 'desc').limit(10).get(),
      db.collection('workouts').where('userId', '==', uid).orderBy('createdAt', 'desc').limit(30).get(),
      db.collection('bmiLogs').where('userId', '==', uid).orderBy('createdAt', 'desc').limit(5).get(),
      db.collection('users').doc(uid).get(),
    ]);

    const memberships = membSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const usageLogs = usageSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const workouts = workoutsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const bmiLogs = bmiSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const user = userSnap.exists ? userSnap.data() : {};

    const totalCalories = workouts.reduce((s, w) => s + (w.calories || 0), 0);
    const totalMinutes = workouts.reduce((s, w) => s + (w.durationMin || 0), 0);
    const activeBalance = memberships
      .filter(m => (m.remainingBalance || 0) > 0)
      .reduce((s, m) => s + m.remainingBalance, 0);
    const activeMembership = memberships.find(m => (m.remainingBalance || 0) > 0) || null;

    res.json({
      ok: true, user, memberships, usageLogs, workouts, bmiLogs,
      stats: { totalCalories, totalMinutes, workoutCount: workouts.length, activeBalance, activeMembership }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /profile — Get user profile
app.get('/profile', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.uid).get();
    res.json({ ok: true, profile: doc.exists ? doc.data() : {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /profile/update — Update profile
app.put('/profile/update', authenticate, async (req, res) => {
  const { displayName, goal, age, gender, heightCm, weightKg } = req.body;
  try {
    const update = {};
    if (displayName !== undefined) update.displayName = displayName;
    if (goal !== undefined) update.goal = goal;
    if (age !== undefined) update.age = Number(age);
    if (gender !== undefined) update.gender = gender;
    if (heightCm !== undefined) update.heightCm = Number(heightCm);
    if (weightKg !== undefined) update.weightKg = Number(weightKg);
    update.updatedAt = admin.firestore.Timestamp.now();
    await db.collection('users').doc(req.uid).set(update, { merge: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GYMS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /gyms — All gyms
app.get('/gyms', async (_req, res) => {
  try {
    const snap = await db.collection('gyms').get();
    res.json({ ok: true, gyms: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /gyms/:id — Single gym details
app.get('/gyms/:id', async (req, res) => {
  try {
    const doc = await db.collection('gyms').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Gym not found' });
    res.json({ ok: true, gym: { id: doc.id, ...doc.data() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /gyms/category/:type — Gyms by category (basic|standard|premium)
app.get('/gyms/category/:type', async (req, res) => {
  const type = req.params.type;
  const label = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  try {
    const snap = await db.collection('gyms').where('category', '==', label).get();
    res.json({ ok: true, category: label, gyms: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. MEMBERSHIP
// ═══════════════════════════════════════════════════════════════════════════════

// GET /membership/plans — Available plans
app.get('/membership/plans', (_req, res) => {
  res.json({
    ok: true,
    plans: [
      { name: 'Basic Plan', category: 'Basic', monthlyFee: 500, months: 1, description: 'Access to all Basic-tier gyms. Perfect for starters.', features: ['Basic gym access', 'Online tracking', 'BMI monitoring'] },
      { name: 'Standard Plan', category: 'Standard', monthlyFee: 800, months: 1, description: 'Access to Basic + Standard gyms with personal trainer sessions.', features: ['Standard & Basic gyms', 'Workout plans', 'Trainer sessions', 'Progress reports'] },
      { name: 'Premium Plan', category: 'Premium', monthlyFee: 1200, months: 1, description: 'Full access to all gym tiers including premium facilities.', features: ['All gym tiers', 'Pool & Spa access', 'Personal nutrition coach', 'Priority support', 'All features'] },
    ],
  });
});

// POST /membership/buy — Purchase a membership
app.post('/membership/buy', authenticate, async (req, res) => {
  const { planName, monthlyFee, months = 1 } = req.body;
  if (!monthlyFee || monthlyFee <= 0) return res.status(400).json({ error: 'monthlyFee required' });
  try {
    const now = admin.firestore.Timestamp.now();
    const end = admin.firestore.Timestamp.fromMillis(Date.now() + Number(months) * 30 * 24 * 3600 * 1000);
    const fee = Number(monthlyFee);
    const doc = {
      userId: req.uid,
      planName: planName || derivePlanName(fee),
      monthlyFee: fee,
      months: Number(months),
      category: deriveCategory(fee),
      startDate: now, endDate: end,
      remainingBalance: fee * Number(months),
      createdAt: now,
    };
    const ref = await db.collection('memberships').add(doc);
    res.json({ ok: true, membershipId: ref.id, membership: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /membership/my — User's memberships
app.get('/membership/my', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('memberships').where('userId', '==', req.uid).get();
    res.json({ ok: true, memberships: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. GYM ACCESS & USAGE (Check-in / Check-out)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /gym/checkin — Start a gym session (stores open session)
app.post('/gym/checkin', authenticate, async (req, res) => {
  const { membershipId, gymId } = req.body;
  if (!membershipId || !gymId) return res.status(400).json({ error: 'membershipId and gymId required' });
  try {
    // Check for existing open session
    const openSnap = await db.collection('sessions')
      .where('userId', '==', req.uid)
      .where('status', '==', 'open').get();
    if (!openSnap.empty) return res.status(400).json({ error: 'You already have an open check-in. Please check out first.' });

    const gymDoc = await db.collection('gyms').doc(gymId).get();
    if (!gymDoc.exists) return res.status(404).json({ error: 'Gym not found' });

    const ref = await db.collection('sessions').add({
      userId: req.uid, membershipId, gymId,
      gymName: gymDoc.data().name,
      checkinTime: admin.firestore.Timestamp.now(),
      status: 'open',
    });
    res.json({ ok: true, sessionId: ref.id, gym: { id: gymDoc.id, ...gymDoc.data() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /gym/checkout — End session and deduct from membership
app.post('/gym/checkout', authenticate, async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  try {
    const sessionRef = db.collection('sessions').doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) return res.status(404).json({ error: 'Session not found' });
    const session = sessionSnap.data();
    if (session.userId !== req.uid) return res.status(403).json({ error: 'Not your session' });
    if (session.status !== 'open') return res.status(400).json({ error: 'Session already closed' });

    const checkoutTime = admin.firestore.Timestamp.now();
    const checkinMs = session.checkinTime.toMillis();
    const checkoutMs = checkoutTime.toMillis();
    const durationMs = checkoutMs - checkinMs;
    const days = Math.max(1, Math.ceil(durationMs / 86400000));

    // Deduct from membership using proportional logic
    const membershipRef = db.collection('memberships').doc(session.membershipId);
    const gymRef = db.collection('gyms').doc(session.gymId);
    let deducted = 0, newBalance = 0;

    await db.runTransaction(async tx => {
      const [mSnap, gSnap] = await Promise.all([tx.get(membershipRef), tx.get(gymRef)]);
      if (!mSnap.exists) throw new Error('Membership not found');
      const membership = mSnap.data();
      const gym = gSnap.data();
      const baseWeekly = Number(membership.monthlyFee) / 4.33;
      const multiplier = Number(gym.multiplier || 1.0);
      const fraction = days / 7;
      let raw = Number((baseWeekly * multiplier * fraction).toFixed(2));
      const balance = Number(membership.remainingBalance || 0);
      deducted = raw > balance ? balance : raw;
      newBalance = Number((balance - deducted).toFixed(2));

      tx.update(membershipRef, { remainingBalance: newBalance });
      tx.update(sessionRef, { status: 'closed', checkoutTime, days, deductedAmount: deducted });

      const usageRef = db.collection('usageLogs').doc();
      tx.set(usageRef, {
        userId: req.uid, membershipId: session.membershipId,
        gymId: session.gymId, gymName: session.gymName,
        from: session.checkinTime, to: checkoutTime,
        days, deductedAmount: deducted,
        createdAt: admin.firestore.Timestamp.now(),
      });
    });

    res.json({ ok: true, days, deducted, newBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /gym/history — All gym visits for user
app.get('/gym/history', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('usageLogs')
      .where('userId', '==', req.uid)
      .orderBy('createdAt', 'desc').limit(50).get();
    res.json({ ok: true, history: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /gym/current-session — Check if user has open session
app.get('/gym/current-session', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('sessions')
      .where('userId', '==', req.uid)
      .where('status', '==', 'open').limit(1).get();
    if (snap.empty) return res.json({ ok: true, session: null });
    const doc = snap.docs[0];
    res.json({ ok: true, session: { id: doc.id, ...doc.data() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. FITNESS TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

// POST /fitness/bmi — Calculate and save BMI
app.post('/fitness/bmi', authenticate, async (req, res) => {
  const { heightCm, weightKg } = req.body;
  if (!heightCm || !weightKg) return res.status(400).json({ error: 'heightCm and weightKg required' });
  const h = Number(heightCm) / 100;
  const w = Number(weightKg);
  const bmi = Number((w / (h * h)).toFixed(1));
  const status = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
  try {
    const ref = await db.collection('bmiLogs').add({
      userId: req.uid, heightCm: Number(heightCm), weightKg: w, bmi, status,
      createdAt: admin.firestore.Timestamp.now(),
    });
    // also update user profile snapshot
    await db.collection('users').doc(req.uid).set(
      { latestBmi: bmi, bmiStatus: status, heightCm: Number(heightCm), weightKg: w, bmiUpdatedAt: admin.firestore.Timestamp.now() },
      { merge: true }
    );
    res.json({ ok: true, bmi, status, id: ref.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /fitness/workout — Save workout activity
app.post('/fitness/workout', authenticate, async (req, res) => {
  const { date, type, durationMin, calories, notes } = req.body;
  try {
    const doc = {
      userId: req.uid,
      date: date ? admin.firestore.Timestamp.fromDate(new Date(date)) : admin.firestore.Timestamp.now(),
      type: type || 'general',
      durationMin: Number(durationMin) || 0,
      calories: Number(calories) || 0,
      notes: notes || '',
      createdAt: admin.firestore.Timestamp.now(),
    };
    const ref = await db.collection('workouts').add(doc);
    res.json({ ok: true, workoutId: ref.id, workout: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /fitness/progress — Fitness progress data
app.get('/fitness/progress', authenticate, async (req, res) => {
  try {
    const [workoutsSnap, bmiSnap] = await Promise.all([
      db.collection('workouts').where('userId', '==', req.uid).orderBy('createdAt', 'desc').limit(50).get(),
      db.collection('bmiLogs').where('userId', '==', req.uid).orderBy('createdAt', 'desc').limit(10).get(),
    ]);
    const workouts = workoutsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const bmiLogs = bmiSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const totalCalories = workouts.reduce((s, w) => s + (w.calories || 0), 0);
    const totalMinutes = workouts.reduce((s, w) => s + (w.durationMin || 0), 0);
    const streak = calcStreak(workouts);
    res.json({ ok: true, workouts, bmiLogs, stats: { totalCalories, totalMinutes, workoutCount: workouts.length, streak } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. ADMIN PANEL
// ═══════════════════════════════════════════════════════════════════════════════

// POST /admin/add-gym
app.post('/admin/add-gym', requireAdmin, async (req, res) => {
  const { name, category, monthlyFee, multiplier, location, amenities } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'name and category required' });
  try {
    const doc = {
      name, category,
      monthlyFee: Number(monthlyFee) || 0,
      multiplier: Number(multiplier) || 1.0,
      location: location || '',
      amenities: Array.isArray(amenities) ? amenities : [],
      createdAt: admin.firestore.Timestamp.now(),
    };
    const ref = await db.collection('gyms').add(doc);
    res.json({ ok: true, gymId: ref.id, gym: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/gyms
app.get('/admin/gyms', requireAdmin, async (_req, res) => {
  try {
    const snap = await db.collection('gyms').get();
    res.json({ ok: true, gyms: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/gym/:id
app.delete('/admin/gym/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('gyms').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/users
app.get('/admin/users', requireAdmin, async (_req, res) => {
  try {
    const snap = await db.collection('users').get();
    res.json({ ok: true, users: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/seed-gyms — seed sample data
app.post('/admin/seed-gyms', requireAdmin, async (_req, res) => {
  try {
    const gyms = [
      { id: 'gym-basic-1', name: 'FlexZone Basic', category: 'Basic', monthlyFee: 500, multiplier: 0.8, location: 'Trivandrum', amenities: ['Cardio', 'Free weights'] },
      { id: 'gym-basic-2', name: 'PowerUp Gym', category: 'Basic', monthlyFee: 600, multiplier: 0.85, location: 'Kochi', amenities: ['Cardio', 'Resistance machines'] },
      { id: 'gym-standard-1', name: 'FitZone Standard', category: 'Standard', monthlyFee: 800, multiplier: 1.0, location: 'Calicut', amenities: ['Full equipment', 'Locker room', 'Trainer'] },
      { id: 'gym-standard-2', name: 'IronCore Studio', category: 'Standard', monthlyFee: 900, multiplier: 1.05, location: 'Thrissur', amenities: ['CrossFit', 'Group classes', 'Locker room'] },
      { id: 'gym-premium-1', name: "Gold's Fitness", category: 'Premium', monthlyFee: 1200, multiplier: 1.2, location: 'Trivandrum', amenities: ['Full equipment', 'Pool', 'Sauna', 'Personal trainer'] },
      { id: 'gym-premium-2', name: 'EliteFit Club', category: 'Premium', monthlyFee: 1500, multiplier: 1.4, location: 'Kochi', amenities: ['Premium equipment', 'Pool', 'Spa', 'Nutrition coach'] },
    ];
    const batch = db.batch();
    gyms.forEach(g => { const { id, ...data } = g; batch.set(db.collection('gyms').doc(id), data, { merge: true }); });
    await batch.commit();
    res.json({ ok: true, seeded: gyms.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function derivePlanName(fee) {
  if (fee <= 600) return 'Basic Plan';
  if (fee <= 1000) return 'Standard Plan';
  return 'Premium Plan';
}
function deriveCategory(fee) {
  if (fee <= 600) return 'Basic';
  if (fee <= 1000) return 'Standard';
  return 'Premium';
}
function calcStreak(workouts) {
  if (!workouts.length) return 0;
  const days = new Set(
    workouts.map(w => {
      const ts = w.date?.toMillis ? w.date.toMillis() : w.createdAt?.toMillis?.() || Date.now();
      return new Date(ts).toDateString();
    })
  );
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    if (days.has(d.toDateString())) streak++; else if (i > 0) break;
  }
  return streak;
}

// ── SPA fallback ───────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'auth', 'login.html'));
});

app.listen(PORT, () => console.log(`\n🏋️  FitConnect running → http://localhost:${PORT}\n`));
