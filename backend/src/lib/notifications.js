// Sistema de Notificações Toast - OD Drive

class NotificationSystem {
  constructor() {
    this.container = null;
    this.init();
  }

  init() {
    // Criar container para toasts
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    document.body.appendChild(this.container);
  }

  show(options) {
    const {
      type = 'info', // success, error, warning, info
      title = '',
      message = '',
      duration = 4000,
      closable = true
    } = options;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };

    toast.innerHTML = `
      <div class="toast-icon">${icons[type]}</div>
      <div class="toast-content">
        ${title ? `<div class="toast-title">${title}</div>` : ''}
        ${message ? `<div class="toast-message">${message}</div>` : ''}
      </div>
      ${closable ? '<button class="toast-close" aria-label="Fechar">×</button>' : ''}
    `;

    this.container.appendChild(toast);

    // Close button
    if (closable) {
      const closeBtn = toast.querySelector('.toast-close');
      closeBtn.addEventListener('click', () => this.hide(toast));
    }

    // Auto-hide
    if (duration > 0) {
      setTimeout(() => this.hide(toast), duration);
    }

    return toast;
  }

  hide(toast) {
    toast.classList.add('toast-hiding');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }

  success(title, message, duration) {
    return this.show({ type: 'success', title, message, duration });
  }

  error(title, message, duration) {
    return this.show({ type: 'error', title, message, duration });
  }

  warning(title, message, duration) {
    return this.show({ type: 'warning', title, message, duration });
  }

  info(title, message, duration) {
    return this.show({ type: 'info', title, message, duration });
  }
}

// Sistema de Modal Customizado
class ModalSystem {
  constructor() {
    this.ensureStylesInjected();
  }

  ensureStylesInjected() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('od-modal-styles')) return;

    const style = document.createElement('style');
    style.id = 'od-modal-styles';
    style.textContent = `
      .od-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(8, 15, 26, 0.55);
        backdrop-filter: blur(4px);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        animation: od-modal-fade-in 0.2s ease-out;
      }

      .od-modal-overlay .od-modal {
        width: min(500px, calc(100vw - 48px));
        background: var(--surface, #ffffff);
        border-radius: var(--radius-lg, 16px);
        box-shadow: 0 20px 40px rgba(6, 25, 56, 0.2);
        display: flex;
        flex-direction: column;
        animation: od-modal-pop 0.25s ease-out;
      }

      .od-modal-overlay .od-modal-header,
      .od-modal-overlay .od-modal-footer {
        padding: 20px 24px;
      }

      .od-modal-overlay .od-modal-header {
        border-bottom: 1px solid var(--line, #e3e5e8);
      }

      .od-modal-overlay .od-modal-body {
        padding: 24px;
      }

      .od-modal-overlay .od-modal-title {
        margin: 0;
        font-size: 20px;
        font-weight: 700;
        color: var(--text-primary, #1a1d23);
      }

      .od-modal-overlay .od-modal-text {
        margin: 0;
        font-size: 15px;
        color: var(--text-secondary, #5e6470);
        line-height: 1.5;
      }

      .od-modal-overlay .od-modal-footer {
        border-top: 1px solid var(--line, #e3e5e8);
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        flex-wrap: wrap;
      }

      .od-modal-overlay .od-modal-btn {
        min-width: 110px;
        border: 1px solid transparent;
        border-radius: 10px;
        padding: 10px 16px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }

      .od-modal-overlay .od-modal-btn-secondary {
        background: #ffffff;
        color: var(--text-primary, #1a1d23);
        border-color: var(--line, #d8dde6);
      }

      .od-modal-overlay .od-modal-btn-secondary:hover {
        background: #f7f9fc;
      }

      .od-modal-overlay .od-modal-btn-primary {
        background: var(--primary, #1173d4);
        color: #ffffff;
        border-color: var(--primary, #1173d4);
      }

      .od-modal-overlay .od-modal-btn-primary:hover {
        filter: brightness(0.95);
      }

      @keyframes od-modal-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes od-modal-pop {
        from {
          opacity: 0;
          transform: translateY(-12px) scale(0.96);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
    `;
    document.head.appendChild(style);
  }

  show(options) {
    const {
      title = 'Atenção',
      message = '',
      type = 'info', // confirm, alert
      confirmText = 'OK',
      cancelText = 'Cancelar',
      onConfirm = null,
      onCancel = null
    } = options;

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'od-modal-overlay';

      overlay.innerHTML = `
        <div class="od-modal">
          <div class="od-modal-header">
            <h2 class="od-modal-title">${title}</h2>
          </div>
          <div class="od-modal-body">
            <p class="od-modal-text">${message}</p>
          </div>
          <div class="od-modal-footer">
            ${type === 'confirm' ? `<button class="od-modal-btn od-modal-btn-secondary btn-cancel">${cancelText}</button>` : ''}
            <button class="od-modal-btn od-modal-btn-primary btn-confirm">${confirmText}</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const modal = overlay.querySelector('.od-modal');
      const btnConfirm = modal.querySelector('.btn-confirm');
      const btnCancel = modal.querySelector('.btn-cancel');

      const close = (result) => {
        overlay.style.opacity = '0';
        document.removeEventListener('keydown', handleEscape);
        setTimeout(() => {
          document.body.removeChild(overlay);
          resolve(result);
        }, 200);
      };

      btnConfirm.addEventListener('click', () => {
        if (onConfirm) onConfirm();
        close(true);
      });

      if (btnCancel) {
        btnCancel.addEventListener('click', () => {
          if (onCancel) onCancel();
          close(false);
        });
      }

      // Fechar ao clicar fora
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          if (onCancel) onCancel();
          close(false);
        }
      });

      // Fechar com ESC
      const handleEscape = (e) => {
        if (e.key === 'Escape') {
          if (onCancel) onCancel();
          close(false);
        }
      };
      document.addEventListener('keydown', handleEscape);
    });
  }

  alert(title, message) {
    return this.show({
      title,
      message,
      type: 'alert',
      confirmText: 'OK'
    });
  }

  confirm(title, message) {
    return this.show({
      title,
      message,
      type: 'confirm',
      confirmText: 'Confirmar',
      cancelText: 'Cancelar'
    });
  }
}

// Instâncias globais
const notify = new NotificationSystem();
const modal = new ModalSystem();

// Expor globalmente
window.notify = notify;
window.modal = modal;
