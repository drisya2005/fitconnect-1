require('dotenv').config();
const admin = require('firebase-admin');

// Initialize Firebase Admin
if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
    const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8'));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} else {
    console.error('FIREBASE_SERVICE_ACCOUNT_B64 not found in .env');
    process.exit(1);
}

const db = admin.firestore();

const gyms = [
    { name: 'FlexZone Basic', category: 'Basic', monthlyFee: 500, multiplier: 0.8, location: 'Trivandrum', amenities: ['Cardio', 'Free weights'] },
    { name: 'PowerUp Gym', category: 'Basic', monthlyFee: 600, multiplier: 0.85, location: 'Kochi', amenities: ['Cardio', 'Resistance machines'] },
    { name: 'FitZone Standard', category: 'Standard', monthlyFee: 800, multiplier: 1.0, location: 'Calicut', amenities: ['Full equipment', 'Locker room', 'Trainer'] },
    { name: 'IronCore Studio', category: 'Standard', monthlyFee: 900, multiplier: 1.05, location: 'Thrissur', amenities: ['CrossFit', 'Group classes', 'Locker room'] },
    { name: 'Gold\'s Fitness', category: 'Premium', monthlyFee: 1200, multiplier: 1.2, location: 'Trivandrum', amenities: ['Full equipment', 'Pool', 'Sauna', 'Personal trainer'] },
    { name: 'EliteFit Club', category: 'Premium', monthlyFee: 1500, multiplier: 1.4, location: 'Kochi', amenities: ['Premium equipment', 'Pool', 'Spa', 'Nutrition coach'] },
];

async function seed() {
    console.log('🌱 Seeding gym data...');
    const batch = db.batch();

    gyms.forEach((gym, index) => {
        const id = `gym-${gym.category.toLowerCase()}-${index + 1}`;
        const ref = db.collection('gyms').doc(id);
        batch.set(ref, {
            ...gym,
            createdAt: admin.firestore.Timestamp.now()
        }, { merge: true });
    });

    await batch.commit();
    console.log(`✅ Seeded ${gyms.length} gyms successfully!`);
    process.exit(0);
}

seed().catch(err => {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
});
