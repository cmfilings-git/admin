// /components/loader.js
let readyPromise = null;
let isVisible = false;
let currentMessage = 'Loading...';

export function initLoader(path = '/components/loader.html') {
  if (readyPromise) return readyPromise;

  readyPromise = fetch(path)
    .then((res) => {
      if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
      return res.text();
    })
    .then((html) => {
      if (!document.getElementById('appLoader')) {
        document.body.insertAdjacentHTML('beforeend', html);
      }
      const el = document.getElementById('appLoader');
      if (el && isVisible) {
        const textEl = document.getElementById('appLoaderText');
        if (textEl) textEl.textContent = currentMessage;
        el.setAttribute('aria-busy', 'true');
        el.classList.add('is-active');
      }
      return el;
    })
    .catch((err) => {
      console.error('Loader mount error:', err);
      readyPromise = null;
      return null;
    });

  return readyPromise;
}

export function showLoader(message = 'Loading...') {
  isVisible = true;
  currentMessage = message;

  const el = document.getElementById('appLoader');
  if (el) {
    const textEl = document.getElementById('appLoaderText');
    if (textEl) textEl.textContent = message;
    el.setAttribute('aria-busy', 'true');
    el.classList.add('is-active');
  } else {
    initLoader();
  }
}

export function hideLoader() {
  isVisible = false;
  const el = document.getElementById('appLoader');
  if (el) {
    el.setAttribute('aria-busy', 'false');
    el.classList.remove('is-active');
  }
}

export async function withLoader(asyncTask, message = 'Loading...') {
  showLoader(message);
  try {
    return await asyncTask();
  } finally {
    hideLoader();
  }
}
