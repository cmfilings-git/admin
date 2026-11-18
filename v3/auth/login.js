import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  browserLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "../firebase/firebase-config.js";

const ADMIN = "shanicm@gmail.com";
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const requested = params.get("next") || "index.html";
const safeNext = !requested.startsWith("/") &&
  !requested.split("/").includes("..") &&
  !requested.includes(":") &&
  !requested.startsWith("\\") ? requested : "index.html";
const destination = new URL(`../${safeNext}`, location.href);

function showError(message) {
  $("error").textContent = message;
  $("error").style.display = "block";
}

function go() {
  location.replace(destination.href);
}

$("togglePassword").addEventListener("click", () => {
  const password = $("password");
  const visible = password.type === "password";
  password.type = visible ? "text" : "password";
  $("togglePassword").setAttribute("aria-label", visible ? "Hide password" : "Show password");
  $("togglePassword").setAttribute("aria-pressed", String(visible));
  $("togglePassword").innerHTML = visible
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a15.4 15.4 0 0 1-3.1 3.8M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7c1.1 0 2.1-.2 3-.5"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
});

$("forgotPassword").addEventListener("click", async () => {
  const email = $("email").value.trim().toLowerCase();
  $("error").style.display = "none";
  $("message").style.display = "none";
  if (!$("email").reportValidity()) return;
  if (email !== ADMIN) {
    showError("Password reset is available only for the authorized administrator.");
    return;
  }
  const button = $("forgotPassword");
  button.disabled = true;
  button.textContent = "Sending…";
  try {
    await sendPasswordResetEmail(auth, email);
    $("message").textContent = "If an account exists for this address, a password reset email has been sent.";
    $("message").style.display = "block";
  } catch (error) {
    const messages = {
      "auth/too-many-requests": "Too many attempts. Please try again later.",
      "auth/network-request-failed": "Network error. Check your internet connection."
    };
    showError(messages[error.code] || error.message || "Could not send the password reset email.");
  } finally {
    button.disabled = false;
    button.textContent = "Forgot password?";
  }
});

onAuthStateChanged(auth, async user => {
  if (!user) return;
  if (user.email?.toLowerCase() === ADMIN) {
    go();
    return;
  }
  await signOut(auth);
  showError("Access denied. This account is not authorized for COREBIQ administrator access.");
});

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("error").style.display = "none";
  $("message").style.display = "none";
  const email = $("email").value.trim().toLowerCase();
  if (email !== ADMIN) {
    showError("Only the authorized administrator can sign in.");
    return;
  }
  const submit = $("submit");
  submit.disabled = true;
  submit.textContent = "Signing in…";
  try {
    await setPersistence(auth, $("rememberMe").checked ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(auth, email, $("password").value);
  } catch (error) {
    const messages = {
      "auth/invalid-credential": "Incorrect email or password.",
      "auth/too-many-requests": "Too many attempts. Please try again later.",
      "auth/network-request-failed": "Network error. Check your internet connection."
    };
    showError(messages[error.code] || error.message || "Sign-in failed.");
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Sign in securely <span aria-hidden="true">→</span>';
  }
});
