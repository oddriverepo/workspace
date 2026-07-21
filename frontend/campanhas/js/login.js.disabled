const API_BASE = window.location.origin;

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

async function handleLogin(e) {
  e.preventDefault();
  hideError();

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    showError('Preencha usuário e senha');
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

    const data = await response.json();

    if (!response.ok) {
      showError(data.error || 'Erro ao fazer login');
      btnLogin.disabled = false;
      btnLogin.textContent = 'Entrar';
      return;
    }

    // Salva token no localStorage
    localStorage.setItem('adminToken', data.token);
    localStorage.setItem('adminUser', JSON.stringify(data.user));

    // Redireciona para o dashboard
    window.location.href = '/index.html';
  } catch (err) {
    showError('Erro de conexão. Verifique sua rede.');
    btnLogin.disabled = false;
    btnLogin.textContent = 'Entrar';
    console.error('Erro no login:', err);
  }
}

loginForm.addEventListener('submit', handleLogin);

// Verifica se já está logado
const token = localStorage.getItem('adminToken');
if (token) {
  // Tenta validar o token
  fetch(`${API_BASE}/api/admin/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(res => {
      if (res.ok) {
        window.location.href = '/index.html';
      }
    })
    .catch(() => {
      // Ignora erro, deixa na tela de login
    });
}
