/**
 * COREBIQ App Check bootstrap.
 * This module is intentionally separate from business modules.
 * Use the reCAPTCHA Enterprise site key registered for this Firebase Web App.
 */
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";

const RECAPTCHA_ENTERPRISE_SITE_KEY = "6Ldj-ycuAAAAALz9fPw3M9hOR-wX5p5NyfS95YP2";

export function initializeCoreAppCheck(app) {
  if (!RECAPTCHA_ENTERPRISE_SITE_KEY ||
      RECAPTCHA_ENTERPRISE_SITE_KEY === "YOUR_RECAPTCHA_ENTERPRISE_SITE_KEY") {
    console.warn("[COREBIQ] App Check is not configured: add the reCAPTCHA Enterprise site key in firebase/app-check.js.");
    return null;
  }

  try {
    return initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
      isTokenAutoRefreshEnabled: true
    });
  } catch (error) {
    // Keep the existing application available while App Check configuration is corrected.
    console.error("[COREBIQ] App Check initialization failed:", error);
    return null;
  }
}
