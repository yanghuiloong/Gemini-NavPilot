// Gemini NavPilot - Content Script v6 (Polished Logic)

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

const DEBUG = true;
function log(...args) { if (DEBUG) console.log('[NavPilot]', ...args); }

// --- Icons ---
const ICONS = {
  prev: `<svg viewBox="0 0 24 24"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>`,
  next: `<svg viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>`,
  top: `<svg viewBox="0 0 24 24"><path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/></svg>`,
  bottom: `<svg viewBox="0 0 24 24"><path d="M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z"/></svg>`
};

// --- Feature 2: Anchor Navigation ---

function updateAnchors() {
  const lines = document.querySelectorAll('.query-text-line');
  const uniqueBubbles = new Set();

  lines.forEach(line => {
    if (line.parentElement) {
      uniqueBubbles.add(line.parentElement);
    }
  });

  sortedAnchors = Array.from(uniqueBubbles)
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
    const rect = sortedAnchors[0].element.getBoundingClientRect();
    if (rect.top < 10) {
      canGoPrev = true; // Scrolled past header, allow jumping back to header
    } else {
      canGoPrev = false; // Header visible, nowhere to go back to
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

  // FIXED: Manual scroll with offset to show images above the prompt
  if (!scrollContainer) scrollContainer = findScrollContainer();

  const headerOffset = 180; // Buffer for images
  const elementRect = target.element.getBoundingClientRect();
  const containerRect = scrollContainer === document.documentElement ? { top: 0 } : scrollContainer.getBoundingClientRect();

  const currentScrollTop = scrollContainer.scrollTop;
  const desiredScrollTop = currentScrollTop + (elementRect.top - containerRect.top) - headerOffset;

  scrollContainer.scrollTo({
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
  if (sortedAnchors.length > 0) {
    let el = sortedAnchors[0].element;
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll')
        && el.scrollHeight > el.clientHeight + 100;
      if (isScrollable) return el;
      el = el.parentElement;
    }
  }
  const candidates = document.querySelectorAll('[class*="scroll"], [class*="chat"], [class*="conversation"], main');
  for (const el of candidates) {
    if (el.scrollHeight > el.clientHeight + 100) return el;
  }
  return document.documentElement;
}

function handleScroll() {
  if (!scrollContainer) {
    scrollContainer = findScrollContainer();
    lastScrollTop = scrollContainer.scrollTop;
  }

  const currentScrollTop = scrollContainer.scrollTop;
  const diff = currentScrollTop - lastScrollTop;
  const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;

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
    if (!scrollContainer || scrollContainer === document.documentElement) {
      scrollContainer = target;
      lastScrollTop = scrollContainer.scrollTop;
    }
  }
  if (!isScrolling) {
    window.requestAnimationFrame(handleScroll);
    isScrolling = true;
  }
}

function showScrollBtn(btn) { if (btn) btn.classList.add('visible'); }
function hideScrollBtn(btn) { if (btn) btn.classList.remove('visible'); }

function scrollToExtremity(where) {
  if (!scrollContainer) scrollContainer = findScrollContainer();
  scrollContainer.scrollTo({
    top: where === 'top' ? 0 : scrollContainer.scrollHeight,
    behavior: 'smooth'
  });
  setTimeout(() => {
    recalculateCurrentIndex();
    updateButtonStates();
  }, 600);
}

// --- UI Injection ---

function createUI() {
  if (document.getElementById('gemini-nav-pilot-panel')) return;

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
}

function updatePanelPosition() {
  if (navPanel) {
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
  }
  requestAnimationFrame(updatePanelPosition);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
