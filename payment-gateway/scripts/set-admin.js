// Run after authenticating with Application Default Credentials:
// gcloud auth application-default login
// node scripts/set-admin.js ADMIN_UID
const admin = require('firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'YOUR_FIREBASE_PROJECT_ID' });
(async () => {
  const uid = process.argv[2];
  if (!uid) throw new Error('Usage: node scripts/set-admin.js FIREBASE_AUTH_UID');
  await admin.auth().setCustomUserClaims(uid, { admin: true });
  console.log(`Admin claim assigned to ${uid}. Ask the user to sign out and sign in again.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
