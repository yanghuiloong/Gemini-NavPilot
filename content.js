// Gemini NavPilot - Content Script v7 (Robust Self-Healing)

// --- State ---
let sortedAnchors = [];
let currentAnchorIndex = -1;
let navPanel = null;
let prevBtn = null;
let nextBtn = null;
let scrollUpBtn = null;
let scrollDownBtn = null;

let scrollContainer = null;
let lastScrollTop = 0;
let isScrolling = false;
let scrollIdleTimer = null;
let healthCheckTimer = null;

const DEBUG = true;
function log(...args) { if (DEBUG) console.log('[NavPilot]', ...args); }

// --- Icons ---
const ICONS = {
  prev: `<svg viewBox="0 0 24 24"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>`,
  next: `<svg viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>`,
  top: `<svg viewBox="0 0 24 24"><path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/></svg>`,
  bottom: `<svg viewBox="0 0 24 24"><path d="M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z"/></svg>`
};

// --- DOM Health Utilities ---

/**
 * Check if a DOM element is still connected to the document.
 * Handles null/undefined safely.
 */
function isElementConnected(el) {
  return !!(el && el.isConnected);
}

/**
 * Get a valid scroll container, refreshing if the cached one is stale.
 * This is the single point of access for scrollContainer to ensure it's always valid.
 */
function getScrollContainer() {
  if (!isElementConnected(scrollContainer)) {
    log('ScrollContainer stale or missing, refreshing...');
    scrollContainer = findScrollContainer();
    lastScrollTop = scrollContainer.scrollTop;
    log('ScrollContainer refreshed:', scrollContainer.tagName, scrollContainer.className);
  }
  return scrollContainer;
}

// --- Feature 2: Anchor Navigation ---

function updateAnchors() {
  const lines = document.querySelectorAll('.query-text-line');
  const uniqueBubbles = new Set();

  lines.forEach(line => {
    // Only add elements that are still connected to the document
    if (line.parentElement && line.parentElement.isConnected) {
      uniqueBubbles.add(line.parentElement);
    }
  });

  sortedAnchors = Array.from(uniqueBubbles)
    .filter(el => el.isConnected) // Double-check: filter out any detached elements
    .sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      return rectA.top - rectB.top;
    })
    .map((el, index) => ({ element: el, index }));

  log('Anchors updated:', sortedAnchors.length);
  updateButtonStates();
}

function recalculateCurrentIndex() {
  // FIXED: Increased threshold to 280px to be larger than headerOffset (180px).
  // This ensures that when we scroll a question to 180px from top, it counts as "passed"
  // so the system knows we are currently AT that question.
  const viewportThreshold = 280;
  let lastPassedIndex = -1;

  for (let i = 0; i < sortedAnchors.length; i++) {
    // Skip detached anchor elements
    if (!isElementConnected(sortedAnchors[i].element)) continue;
    const rect = sortedAnchors[i].element.getBoundingClientRect();
    if (rect.top < viewportThreshold) {
      lastPassedIndex = i;
    }
  }

  currentAnchorIndex = lastPassedIndex;
}

function updateButtonStates() {
  if (!prevBtn || !nextBtn) return;

  recalculateCurrentIndex();

  // Logic for Prev Button Disabled State:
  // 1. If we are before the first anchor (index < 0) -> Disabled
  // 2. If we are AT the first anchor (index == 0), AND it is near the top -> Disabled (already there)

  let canGoPrev = false;

  if (currentAnchorIndex > 0) {
    canGoPrev = true;
  } else if (currentAnchorIndex === 0) {
    // We are at the first anchor. 
    // If we have scrolled deeper into it (top is negative or very small), we can go "Prev" (back to its top).
    // If the top is already visible comfortably (e.g. > 10px), we are effectively at the start.
    if (isElementConnected(sortedAnchors[0].element)) {
      const rect = sortedAnchors[0].element.getBoundingClientRect();
      if (rect.top < 10) {
        canGoPrev = true; // Scrolled past header, allow jumping back to header
      } else {
        canGoPrev = false; // Header visible, nowhere to go back to
      }
    }
  }

  // Logic for Next Button
  const canGoNext = currentAnchorIndex < sortedAnchors.length - 1;

  prevBtn.classList.toggle('disabled', !canGoPrev);
  nextBtn.classList.toggle('disabled', !canGoNext);
}

function scrollToAnchor(direction) {
  updateAnchors();
  recalculateCurrentIndex();

  if (sortedAnchors.length === 0) return;

  let targetIndex;

  if (direction === 'prev') {
    if (currentAnchorIndex < 0) return;

    // Jump Logic:
    // If we are at index N.
    // If we are deep inside N, jump to start of N.
    // If we are already at start of N, jump to start of N-1.

    if (!isElementConnected(sortedAnchors[currentAnchorIndex].element)) {
      // Current anchor is stale, refresh and retry
      updateAnchors();
      recalculateCurrentIndex();
      if (currentAnchorIndex < 0) return;
    }

    const currentRect = sortedAnchors[currentAnchorIndex].element.getBoundingClientRect();
    const isAtStart = currentRect.top > 10 && currentRect.top < 300; // Loosely defined "at start"

    if (isAtStart && currentAnchorIndex > 0) {
      targetIndex = currentAnchorIndex - 1;
    } else {
      targetIndex = currentAnchorIndex;
    }

  } else {
    targetIndex = currentAnchorIndex + 1;
    if (targetIndex >= sortedAnchors.length) return;
  }

  const target = sortedAnchors[targetIndex];

  // Validate target element is still in the DOM
  if (!isElementConnected(target.element)) {
    log('Target anchor is detached, refreshing anchors...');
    updateAnchors();
    return; // Bail out, user can try again with fresh anchors
  }

  // Use getScrollContainer() to ensure valid container
  const container = getScrollContainer();

  const headerOffset = 180; // Buffer for images
  const elementRect = target.element.getBoundingClientRect();
  const containerRect = container === document.documentElement ? { top: 0 } : container.getBoundingClientRect();

  const currentScrollTop = container.scrollTop;
  const desiredScrollTop = currentScrollTop + (elementRect.top - containerRect.top) - headerOffset;

  container.scrollTo({
    top: desiredScrollTop,
    behavior: 'smooth'
  });

  setTimeout(() => {
    recalculateCurrentIndex();
    updateButtonStates();
  }, 600);
}

// --- Feature 1: Scroll Jumper ---

function findScrollContainer() {
  // Strategy 1: Walk up from a known anchor element
  if (sortedAnchors.length > 0) {
    // Find a connected anchor to walk up from
    for (let i = 0; i < sortedAnchors.length; i++) {
      if (isElementConnected(sortedAnchors[i].element)) {
        let el = sortedAnchors[i].element;
        while (el && el !== document.body) {
          const style = window.getComputedStyle(el);
          const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll')
            && el.scrollHeight > el.clientHeight + 100;
          if (isScrollable) return el;
          el = el.parentElement;
        }
        break; // Only need to try one connected anchor
      }
    }
  }

  // Strategy 2: Query for scrollable elements by class hints
  const candidates = document.querySelectorAll('[class*="scroll"], [class*="chat"], [class*="conversation"], main');
  for (const el of candidates) {
    if (el.scrollHeight > el.clientHeight + 100 && el.isConnected) return el;
  }

  // Strategy 3: Brute-force search all elements for a large scrollable container
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const style = window.getComputedStyle(el);
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll')
      && el.scrollHeight > el.clientHeight + 200
      && el.clientHeight > 300) {
      return el;
    }
  }

  return document.documentElement;
}

function handleScroll() {
  const container = getScrollContainer();

  const currentScrollTop = container.scrollTop;
  const diff = currentScrollTop - lastScrollTop;
  const maxScroll = container.scrollHeight - container.clientHeight;

  updateButtonStates();

  if (Math.abs(diff) > 3) {
    if (diff > 0 && currentScrollTop < maxScroll - 50) {
      showScrollBtn(scrollDownBtn);
      hideScrollBtn(scrollUpBtn);
    } else if (diff < 0 && currentScrollTop > 50) {
      showScrollBtn(scrollUpBtn);
      hideScrollBtn(scrollDownBtn);
    }
  }

  if (currentScrollTop < 20) {
    hideScrollBtn(scrollUpBtn);
    // Force update anchors at very top to ensure prev is disabled
    updateButtonStates();
  }
  if (currentScrollTop > maxScroll - 20) hideScrollBtn(scrollDownBtn);

  lastScrollTop = currentScrollTop;
  isScrolling = false;

  clearTimeout(scrollIdleTimer);
  scrollIdleTimer = setTimeout(() => {
    hideScrollBtn(scrollUpBtn);
    hideScrollBtn(scrollDownBtn);
  }, 3000);
}

function onScrollEvent(event) {
  const target = event.target;
  if (target instanceof HTMLElement && target.scrollHeight > target.clientHeight + 50) {
    // If current scrollContainer is stale (detached) or is the fallback, adopt this new one
    if (!isElementConnected(scrollContainer) || scrollContainer === document.documentElement) {
      scrollContainer = target;
      lastScrollTop = scrollContainer.scrollTop;
      log('ScrollContainer adopted from scroll event:', target.tagName, target.className);
    }
  }
  if (!isScrolling) {
    window.requestAnimationFrame(handleScroll);
    isScrolling = true;
  }
}

function showScrollBtn(btn) { if (btn && isElementConnected(btn)) btn.classList.add('visible'); }
function hideScrollBtn(btn) { if (btn && isElementConnected(btn)) btn.classList.remove('visible'); }

function scrollToExtremity(where) {
  const container = getScrollContainer();
  container.scrollTo({
    top: where === 'top' ? 0 : container.scrollHeight,
    behavior: 'smooth'
  });
  setTimeout(() => {
    recalculateCurrentIndex();
    updateButtonStates();
  }, 600);
}

// --- UI Injection (with self-healing) ---

function ensureUI() {
  // Check if our UI elements are still in the document
  const panelInDOM = isElementConnected(navPanel);
  const scrollUpInDOM = isElementConnected(scrollUpBtn);
  const scrollDownInDOM = isElementConnected(scrollDownBtn);

  if (panelInDOM && scrollUpInDOM && scrollDownInDOM) {
    return; // All good
  }

  log('UI elements missing from DOM, re-injecting...',
    { panelInDOM, scrollUpInDOM, scrollDownInDOM });

  // Clean up any orphaned elements that might still exist
  const existingPanel = document.getElementById('gemini-nav-pilot-panel');
  const existingScrollUp = document.getElementById('scroll-to-top');
  const existingScrollDown = document.getElementById('scroll-to-bottom');
  if (existingPanel) existingPanel.remove();
  if (existingScrollUp) existingScrollUp.remove();
  if (existingScrollDown) existingScrollDown.remove();

  // Reset references
  navPanel = null;
  prevBtn = null;
  nextBtn = null;
  scrollUpBtn = null;
  scrollDownBtn = null;

  // Re-create
  createUI();
}

function createUI() {
  if (document.getElementById('gemini-nav-pilot-panel')) {
    // Element already exists in DOM, sync our references to it
    navPanel = document.getElementById('gemini-nav-pilot-panel');
    scrollUpBtn = document.getElementById('scroll-to-top');
    scrollDownBtn = document.getElementById('scroll-to-bottom');
    // Buttons inside panel
    const btns = navPanel.querySelectorAll('.nav-btn');
    if (btns.length >= 2) {
      prevBtn = btns[0];
      nextBtn = btns[1];
    }
    return;
  }

  navPanel = document.createElement('div');
  navPanel.id = 'gemini-nav-pilot-panel';

  prevBtn = document.createElement('div');
  prevBtn.className = 'nav-btn';
  prevBtn.innerHTML = ICONS.prev;
  prevBtn.title = "Previous Question";
  prevBtn.onclick = () => scrollToAnchor('prev');

  nextBtn = document.createElement('div');
  nextBtn.className = 'nav-btn';
  nextBtn.innerHTML = ICONS.next;
  nextBtn.title = "Next Question";
  nextBtn.onclick = () => scrollToAnchor('next');

  navPanel.appendChild(prevBtn);
  navPanel.appendChild(nextBtn);
  document.body.appendChild(navPanel);

  scrollUpBtn = document.createElement('div');
  scrollUpBtn.id = 'scroll-to-top';
  scrollUpBtn.className = 'scroll-jumper';
  scrollUpBtn.innerHTML = ICONS.top;
  scrollUpBtn.title = "Scroll to Start";
  scrollUpBtn.onclick = () => scrollToExtremity('top');
  document.body.appendChild(scrollUpBtn);

  scrollDownBtn = document.createElement('div');
  scrollDownBtn.id = 'scroll-to-bottom';
  scrollDownBtn.className = 'scroll-jumper';
  scrollDownBtn.innerHTML = ICONS.bottom;
  scrollDownBtn.title = "Scroll to End";
  scrollDownBtn.onclick = () => scrollToExtremity('bottom');
  document.body.appendChild(scrollDownBtn);
}

// --- Health Check (Periodic Self-Healing) ---

function healthCheck() {
  // 1. Ensure UI elements are still in the DOM
  ensureUI();

  // 2. Validate scroll container
  if (!isElementConnected(scrollContainer)) {
    log('HealthCheck: scrollContainer detached, refreshing...');
    scrollContainer = findScrollContainer();
    lastScrollTop = scrollContainer.scrollTop;
  }

  // 3. Refresh anchors (filters out stale elements automatically)
  updateAnchors();

  // 4. Re-validate scroll listeners are working by checking if scrollContainer
  //    has a reasonable scrollHeight (> 0 means the page has content)
  const container = getScrollContainer();
  if (container.scrollHeight <= container.clientHeight) {
    // The container might be wrong (e.g. a collapsed element), force re-find
    log('HealthCheck: scrollContainer has no scrollable area, forcing refresh...');
    scrollContainer = null;
    getScrollContainer();
  }
}

function init() {
  createUI();
  setTimeout(() => {
    updateAnchors();
    scrollContainer = findScrollContainer();
    recalculateCurrentIndex();
  }, 500);

  const observer = new MutationObserver(() => updateAnchors());
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('scroll', onScrollEvent, { capture: true, passive: true });
  document.addEventListener('scroll', onScrollEvent, { capture: true, passive: true });

  // Start positioning loop
  updatePanelPosition();

  // Start periodic health check every 10 seconds
  if (healthCheckTimer) clearInterval(healthCheckTimer);
  healthCheckTimer = setInterval(healthCheck, 10000);
  log('Init complete. Health check interval set to 10s.');
}

function updatePanelPosition() {
  // Ensure UI elements exist before positioning
  if (!isElementConnected(navPanel)) {
    requestAnimationFrame(updatePanelPosition);
    return;
  }

  // Target the "Model Selection" icon (Pro/Gemini dropdown)
  const target = document.querySelector('.input-area-switch');

  if (target) {
    const targetRect = target.getBoundingClientRect();
    const panelRect = navPanel.getBoundingClientRect();

    // Position logic: 60px to the right of the target switch to avoid send button
    const left = targetRect.right + 70;
    // Vertically centered relative to the switch button, moved up 10px for visual alignment
    const top = (targetRect.top + (targetRect.height - panelRect.height) / 2) - 23;

    navPanel.style.left = `${left}px`;
    navPanel.style.top = `${top}px`;

    // Clear conflicting styles
    navPanel.style.bottom = 'auto';
    navPanel.style.right = 'auto';
    navPanel.style.margin = '0';
  } else {
    // Fallback: if target missing (e.g. initial load or different layout), stick to bottom right
    if (navPanel.style.left === '' || navPanel.style.left === '0px') {
      navPanel.style.bottom = '40px';
      navPanel.style.right = '40px';
      navPanel.style.left = 'auto';
      navPanel.style.top = 'auto';
    }
  }

  // Dynamically position scroll-to-bottom button relative to input area top edge
  if (isElementConnected(scrollDownBtn)) {
    // Find the input area container (the entire input box region)
    const inputArea = document.querySelector('.input-area-container')
      || document.querySelector('.text-input-field')
      || document.querySelector('[class*="input-area"]');

    if (inputArea) {
      const inputRect = inputArea.getBoundingClientRect();
      // Position the button 50px above the top edge of the input area
      scrollDownBtn.style.bottom = 'auto';
      scrollDownBtn.style.top = `${inputRect.top - 50}px`;
    } else {
      // Fallback to a fixed bottom position if input area not found
      scrollDownBtn.style.top = 'auto';
      scrollDownBtn.style.bottom = '200px';
    }
  }

  requestAnimationFrame(updatePanelPosition);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
