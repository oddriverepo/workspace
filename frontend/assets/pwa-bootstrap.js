(function pwaBootstrap() {
  const options = window.__PWA_OPTIONS__ || null;
  if (!options || typeof window === 'undefined') return;

  const appId = String(options.appId || 'oddrive').trim() || 'oddrive';
  const appName = String(options.appName || 'OD Drive').trim() || 'OD Drive';
  const manifestPath = String(options.manifest || '').trim();
  const serviceWorkerPath = String(options.serviceWorker || '').trim();
  const serviceWorkerScope = String(options.scope || '').trim();
  const themeColor = String(options.themeColor || '#1d6fd8').trim();
  const promptText = String(
    options.promptText || `Instale ${appName} para abrir em tela cheia e acessar mais rápido.`,
  ).trim();
  const iosText = String(
    options.iosText || `No iPhone: toque em Compartilhar e depois em "Adicionar à Tela de Início".`,
  ).trim();
  const installButtonText = String(options.installButtonText || 'Instalar').trim() || 'Instalar';
  const dismissButtonText = String(options.dismissButtonText || 'Agora não').trim() || 'Agora não';
  const dismissDays = Number(options.dismissDays || 7);
  const dismissTtlMs = Number.isFinite(dismissDays) && dismissDays > 0
    ? dismissDays * 24 * 60 * 60 * 1000
    : 7 * 24 * 60 * 60 * 1000;

  const storageKey = `oddrive:pwa:dismissed:${appId}`;
  const styleId = 'oddrive-pwa-banner-style';
  let deferredInstallPrompt = null;
  let bannerEl = null;
  let installButtonEl = null;

  function isStandalone() {
    const standaloneMedia = window.matchMedia
      ? window.matchMedia('(display-mode: standalone)').matches
      : false;
    const iosStandalone = window.navigator && window.navigator.standalone === true;
    return Boolean(standaloneMedia || iosStandalone);
  }

  function isIosSafari() {
    const ua = String(window.navigator?.userAgent || '').toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua);
    const isSafari = /safari/.test(ua) && !/crios|fxios|edgios|opios/.test(ua);
    return isIOS && isSafari;
  }

  function readDismissInfo() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const ts = Number(parsed.ts);
      return Number.isFinite(ts) ? ts : null;
    } catch (_) {
      return null;
    }
  }

  function markDismissed() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ ts: Date.now() }));
    } catch (_) {}
  }

  function clearDismissed() {
    try {
      localStorage.removeItem(storageKey);
    } catch (_) {}
  }

  function isDismissed() {
    const ts = readDismissInfo();
    if (!Number.isFinite(ts)) return false;
    return (Date.now() - ts) < dismissTtlMs;
  }

  function ensureHeadMeta() {
    if (!document.head) return;
    if (manifestPath && !document.querySelector('link[rel="manifest"]')) {
      const manifest = document.createElement('link');
      manifest.rel = 'manifest';
      manifest.href = manifestPath;
      document.head.appendChild(manifest);
    }

    if (!document.querySelector('meta[name="theme-color"]')) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = themeColor;
      document.head.appendChild(meta);
    }
  }

  function ensureStyles() {
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .pwa-install-banner {
        position: fixed;
        left: 12px;
        right: 12px;
        bottom: 12px;
        z-index: 14000;
        border: 1px solid #d8e0ea;
        border-radius: 14px;
        background: #ffffff;
        box-shadow: 0 12px 34px rgba(16, 25, 34, 0.16);
        padding: 12px 12px 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .pwa-install-title {
        margin: 0;
        font-weight: 800;
        font-size: 14px;
        color: #0f1e2e;
      }
      .pwa-install-text {
        margin: 0;
        color: #4c5c6d;
        font-size: 13px;
        line-height: 1.35;
      }
      .pwa-install-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .pwa-install-btn {
        appearance: none;
        border: 1px solid transparent;
        border-radius: 10px;
        padding: 8px 12px;
        font-weight: 700;
        font-size: 12px;
        cursor: pointer;
      }
      .pwa-install-btn.primary {
        background: #1d6fd8;
        color: #fff;
      }
      .pwa-install-btn.ghost {
        background: #f5f7fa;
        color: #223447;
        border-color: #d8e0ea;
      }
      @media (min-width: 700px) {
        .pwa-install-banner {
          max-width: 520px;
          right: auto;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function closeBanner(rememberDismiss = true) {
    if (bannerEl && bannerEl.parentNode) {
      bannerEl.parentNode.removeChild(bannerEl);
    }
    bannerEl = null;
    installButtonEl = null;
    if (rememberDismiss) markDismissed();
  }

  function openBanner({ title, text, showInstallButton }) {
    if (isStandalone()) return;
    if (isDismissed()) return;
    ensureStyles();

    if (!bannerEl) {
      bannerEl = document.createElement('aside');
      bannerEl.className = 'pwa-install-banner';
      bannerEl.innerHTML = `
        <h3 class="pwa-install-title"></h3>
        <p class="pwa-install-text"></p>
        <div class="pwa-install-actions"></div>
      `;
      document.body.appendChild(bannerEl);
    }

    const titleEl = bannerEl.querySelector('.pwa-install-title');
    const textEl = bannerEl.querySelector('.pwa-install-text');
    const actionsEl = bannerEl.querySelector('.pwa-install-actions');
    if (!titleEl || !textEl || !actionsEl) return;

    titleEl.textContent = title;
    textEl.textContent = text;
    actionsEl.innerHTML = '';

    if (showInstallButton) {
      const installBtn = document.createElement('button');
      installBtn.type = 'button';
      installBtn.className = 'pwa-install-btn primary';
      installBtn.textContent = installButtonText;
      installButtonEl = installBtn;
      actionsEl.appendChild(installBtn);
    } else {
      installButtonEl = null;
    }

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'pwa-install-btn ghost';
    dismissBtn.textContent = dismissButtonText;
    dismissBtn.addEventListener('click', () => closeBanner(true));
    actionsEl.appendChild(dismissBtn);
  }

  async function handleInstallClick() {
    if (!deferredInstallPrompt) return;
    const currentPrompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    try {
      await currentPrompt.prompt();
      const choice = await currentPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        clearDismissed();
        closeBanner(false);
      } else {
        markDismissed();
        closeBanner(true);
      }
    } catch (_) {
      markDismissed();
      closeBanner(true);
    }
  }

  function registerServiceWorker() {
    if (!serviceWorkerPath || !('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      const registrationOptions = {};
      if (serviceWorkerScope) registrationOptions.scope = serviceWorkerScope;
      navigator.serviceWorker.register(serviceWorkerPath, registrationOptions)
        .catch(error => {
          console.warn('[PWA] Falha ao registrar service worker:', error?.message || error);
        });
    });
  }

  function setupInstallFlow() {
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      openBanner({
        title: `${appName} no celular`,
        text: promptText,
        showInstallButton: true,
      });
      if (installButtonEl) installButtonEl.addEventListener('click', handleInstallClick, { once: true });
    });

    window.addEventListener('appinstalled', () => {
      clearDismissed();
      closeBanner(false);
    });

    if (isIosSafari() && !isStandalone()) {
      setTimeout(() => {
        if (!deferredInstallPrompt) {
          openBanner({
            title: `${appName} no celular`,
            text: iosText,
            showInstallButton: false,
          });
        }
      }, 800);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureHeadMeta();
      registerServiceWorker();
      setupInstallFlow();
    }, { once: true });
  } else {
    ensureHeadMeta();
    registerServiceWorker();
    setupInstallFlow();
  }
})();
