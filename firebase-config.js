/* ============================================================
   TSM — Firebase Configuration
   ⚠️  SETUP REQUIRED — Fill in your own Firebase project values.

   Steps:
   1. Go to https://console.firebase.google.com
   2. Create a new project (or open existing)
   3. Add a Web App — copy the config object below
   4. Enable Authentication → Google sign-in provider
   5. Enable Firestore Database (Start in production mode)
   6. Project Settings → Cloud Messaging → Generate a VAPID key pair
   7. Copy the public key into VAPID_KEY below
   8. Deploy Cloud Functions (see functions/README.md)
   ============================================================ */

const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
  measurementId:     "YOUR_MEASUREMENT_ID",   // optional
};

// Web Push VAPID public key
// Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Key pair
const VAPID_KEY = "YOUR_VAPID_KEY";

/* ── Firestore Security Rules (paste into Firebase Console) ──

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}

─────────────────────────────────────────────────────────── */
