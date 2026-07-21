// Usa window.API_BASE definido em config.js
const API_BASE = window.API_BASE || '';

const loginForm = document.getElementById('loginForm');
const btnLogin = document.getElementById('btnLogin');
const errorMessage = document.getElementById('errorMessage');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
}

function hideError() {
  errorMessage.classList.remove('show');
}

function redirectToPortal() {
  // Redireciona para o workspace (raiz do frontend unificado)
  window.location.href = '/';
}

async function handleLogin(e) {
  e.preventDefault();
  hideError();

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    showError('Preencha usuário e senha.');
    return;
  }

  btnLogin.disabled = true;
  btnLogin.textContent = 'Entrando...';

  try {
    const response = await fetch(`${API_BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    let data = null;
    try {
      data = await response.json();
    } catch (e) {
      // resposta não-json (ex.: 405/500 sem corpo)
    }

    if (!response.ok) {
      showError((data && data.error) || `Erro ao fazer login. (${response.status})`);
      btnLogin.disabled = false;
      btnLogin.textContent = 'Entrar';
      return;
    }

    localStorage.setItem('adminToken', data.token);
    localStorage.setItem('adminUser', JSON.stringify(data.user));

    redirectToPortal();
  } catch (err) {
    showError('Erro de conexão. Verifique sua rede.');
    btnLogin.disabled = false;
    btnLogin.textContent = 'Entrar';
    console.error('Erro no login:', err);
  }
}

async function tryAutoLogin() {
  const token = localStorage.getItem('adminToken');
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/api/admin/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      redirectToPortal();
    } else {
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminUser');
    }
  } catch (e) {
    // se offline/erro, mantém na tela para novo login
  }
}

loginForm?.addEventListener('submit', handleLogin);

// Tenta auto-login ao carregar a página
tryAutoLogin();
