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

const firebaseConfig = {
  apiKey: "AIzaSyA8Uit9CjWUGPkc-reEDndxuClg6dowzl8",
  authDomain: "tsm-planner.firebaseapp.com",
  projectId: "tsm-planner",
  storageBucket: "tsm-planner.firebasestorage.app",
  messagingSenderId: "585712753497",
  appId: "1:585712753497:web:1773882934b93390a10a48",
  measurementId: "G-Q8W8HVX6BH"
};

// Web Push VAPID public key
// Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Key pair
const VAPID_KEY = "OSklSvFNGLyBBYMtZ2jkUeOts-7-hwgv7efEuBdctIw";

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
