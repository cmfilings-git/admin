<!-- gemini-bottom-nav.html | Reusable Gemini-inspired bottom navigation
     Include on any mobile/app page with:
     <div id="app-bottom-nav-mount"></div>
     <script src="/components/gemini-bottom-nav.js"></script>
-->
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;600&display=swap');

:root {
  /* Gemini UI Color Palette */
  --gn-bg: #f3f6fc;
  --gn-text: #444746;
  --gn-hover: #e1e5ea;
  --gn-active-bg: #d3e3fd; /* Gemini light blue pill */
  --gn-active-text: #041e49;
  --gn-border: transparent;
  --gn-z: 9990;
}

@media (prefers-color-scheme: dark) {
  :root {
    --gn-bg: #131314;
    --gn-text: #c4c7c5;
    --gn-hover: #282a2c;
    --gn-active-bg: #004a77;
    --gn-active-text: #c2e7ff;
    --gn-border: #1f1f20;
  }
}

#gn-bottom-nav, #gn-bottom-nav * { box-sizing: border-box; }

#gn-bottom-nav {
  position: fixed; 
  bottom: 0; left: 0; right: 0; 
  z-index: var(--gn-z);
  background: var(--gn-bg);
  border-top: 1px solid var(--gn-border);
  display: flex; 
  justify-content: space-evenly; 
  align-items: center;
  padding: 12px 8px calc(12px + env(safe-area-inset-bottom));
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.gn-item {
  display: flex; 
  flex-direction: column; 
  align-items: center; 
  gap: 4px;
  text-decoration: none; 
  color: var(--gn-text);
  min-width: 64px; 
  cursor: pointer;
}

.gn-icon-pill {
  width: 64px; 
  height: 32px; 
  border-radius: 16px;
  display: grid; 
  place-items: center;
  transition: background-color 0.25s ease, color 0.25s ease;
  color: var(--gn-text);
}

.gn-item:hover .gn-icon-pill { 
  background: var(--gn-hover); 
}

.gn-item.gn-active { 
  color: var(--gn-active-text); 
}

.gn-item.gn-active .gn-icon-pill { 
  background: var(--gn-active-bg); 
  color: var(--gn-active-text); 
}

/* Base Icon Style (Outlined) */
.gn-item svg { 
  width: 24px; 
  height: 24px; 
  stroke: currentColor; 
  fill: none; 
  stroke-width: 2; 
  stroke-linecap: round; 
  stroke-linejoin: round;
  transition: fill 0.25s ease;
}

/* Active Icon Style (Filled) */
.gn-item.gn-active svg { 
  fill: currentColor; 
  stroke-width: 1.5; /* Slight adjustment for filled clarity */
}

/* Exception for Gemini Sparkle which is custom drawn */
.gn-item.gn-active svg.gn-sparkle {
  fill: currentColor;
  stroke: none;
}

.gn-label { 
  font-size: 12px; 
  font-weight: 600; 
  letter-spacing: 0.2px;
}

/* Hide on desktop sizes if needed */
@media (min-width: 768px) {
  #gn-bottom-nav { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .gn-icon-pill, .gn-item svg { transition: none; }
}
</style>

<nav id="gn-bottom-nav" aria-label="Bottom Navigation">
  
  <a class="gn-item" data-gn-href="chat" href="/chat.html">
    <div class="gn-icon-pill">
      <!-- Gemini Sparkle Style Icon -->
      <svg class="gn-sparkle" viewBox="0 0 24 24">
        <path d="M12 2.5L14.2 9.8L21.5 12L14.2 14.2L12 21.5L9.8 14.2L2.5 12L9.8 9.8L12 2.5Z" />
      </svg>
    </div>
    <span class="gn-label">Chat</span>
  </a>

  <a class="gn-item" data-gn-href="history" href="/history.html">
    <div class="gn-icon-pill">
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    </div>
    <span class="gn-label">History</span>
  </a>

  <a class="gn-item" data-gn-href="explore" href="/explore.html">
    <div class="gn-icon-pill">
      <svg viewBox="0 0 24 24">
        <path d="M14.1 9.9L9.9 14.1"/>
        <circle cx="12" cy="12" r="10"/>
        <path d="M16.2 7.8L7.8 16.2"/>
      </svg>
    </div>
    <span class="gn-label">Explore</span>
  </a>

  <a class="gn-item" data-gn-href="profile" href="/profile.html">
    <div class="gn-icon-pill">
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="5"/>
        <path d="M20 21a8 8 0 0 0-16 0"/>
      </svg>
    </div>
    <span class="gn-label">Profile</span>
  </a>

</nav>

<script>
(function () {
  const bottomNav = document.getElementById('gn-bottom-nav');
  if (!bottomNav || bottomNav.dataset.initialized) return;
  bottomNav.dataset.initialized = '1';

  const links = [...bottomNav.querySelectorAll('.gn-item')];
  
  // 1. Highlight the current module using data-gn-page on body, or the URL filename.
  const page = document.body.dataset.gnPage || location.pathname.split('/').pop().replace(/\.html?$/i, '');
  let foundActive = false;

  links.forEach(link => {
    const key = link.dataset.gnHref;
    if (key && (key === page || (page === '' && key === 'chat'))) {
      link.classList.add('gn-active');
      link.setAttribute('aria-current', 'page');
      foundActive = true;
    } else {
      link.classList.remove('gn-active');
      link.removeAttribute('aria-current');
    }
  });

  // Default to first item if no match found
  if (!foundActive && links.length > 0) {
      links[0].classList.add('gn-active');
      links[0].setAttribute('aria-current', 'page');
  }

  // 2. Client-side routing interceptor (optional SPA behavior)
  links.forEach(link => {
    link.addEventListener('click', (e) => {
      // If you are using a Single Page App architecture, you can prevent default
      // and handle state switching manually. 
      const isSpaMode = document.body.hasAttribute('data-gn-spa');
      
      if (isSpaMode) {
        e.preventDefault();
        
        // Remove active state from all
        links.forEach(l => {
          l.classList.remove('gn-active');
          l.removeAttribute('aria-current');
        });
        
        // Set new active state
        link.classList.add('gn-active');
        link.setAttribute('aria-current', 'page');

        // Dispatch event for your app to catch and render the new view
        const targetView = link.dataset.gnHref;
        document.dispatchEvent(new CustomEvent('gemini-nav:navigate', { 
            detail: { view: targetView } 
        }));
      }
    });
  });

  // 3. Optional programmatic configuration via window.GEMINI_NAV
  const cfg = window.GEMINI_NAV || {};
  if (Array.isArray(cfg.tabs)) {
    bottomNav.innerHTML = '';
    cfg.tabs.forEach(tab => {
      const a = document.createElement('a');
      a.className = 'gn-item';
      a.href = tab.href || '#';
      a.dataset.gnHref = tab.key || '';
      
      const pill = document.createElement('div');
      pill.className = 'gn-icon-pill';
      pill.innerHTML = tab.svg || '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>';
      
      const span = document.createElement('span');
      span.className = 'gn-label';
      span.textContent = tab.label || 'Tab';
      
      a.appendChild(pill);
      a.appendChild(span);
      
      if (tab.key === page) {
        a.classList.add('gn-active');
        a.setAttribute('aria-current', 'page');
      }
      
      bottomNav.appendChild(a);
    });
  }
})();
</script>
