import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "../firebase/firebase-config.js";

export function initWelcomeCompanyName() {
  const nameElement = document.getElementById("welcome-company-name");
  if (!nameElement) return;

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  let requestId = 0;

  onAuthStateChanged(auth, async user => {
    const currentRequest = ++requestId;
    if (!user) {
      nameElement.textContent = "Company name unavailable";
      return;
    }

    nameElement.textContent = "Loading company name…";
    try {
      const companySnapshot = await getDoc(doc(db, "settings", "company_profile"));
      if (currentRequest !== requestId) return;
      const companyName = companySnapshot.exists() && typeof companySnapshot.data().name === "string"
        ? companySnapshot.data().name.trim()
        : "";
      nameElement.textContent = companyName || "Company name not set";
    } catch (error) {
      console.error("Company name could not be loaded from Firebase:", error);
      if (currentRequest === requestId) nameElement.textContent = "Company name unavailable";
    }
  }, error => {
    console.error("Firebase sign-in state could not be read for the welcome card:", error);
    nameElement.textContent = "Company name unavailable";
  });
}
