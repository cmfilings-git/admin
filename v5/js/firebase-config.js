// Compatibility bridge for existing settings modules.
// Keeps their current imports unchanged while using the shared App Check bootstrap.
import { firebaseApp } from "../firebase/firebase-config.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
