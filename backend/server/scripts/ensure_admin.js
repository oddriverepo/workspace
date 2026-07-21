import dotenv from 'dotenv';
import bcrypt from 'bcrypt';

dotenv.config();

const USERNAME = String(process.env.ADMIN_BOOTSTRAP_USERNAME || '').trim();
const NEW_PASS = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || '');

if (!USERNAME || !NEW_PASS) {
  console.error('Defina ADMIN_BOOTSTRAP_USERNAME e ADMIN_BOOTSTRAP_PASSWORD no ambiente.');
  process.exit(1);
}
if (NEW_PASS.length < 12) {
  console.error('ADMIN_BOOTSTRAP_PASSWORD precisa ter pelo menos 12 caracteres.');
  process.exit(1);
}

(async ()=>{
  try{
    const { findAdminUserByUsername, createAdminUser, updateAdminUser } = await import('../services/db.js');
    const normalized = String(USERNAME).toLowerCase().trim();
    const existing = await findAdminUserByUsername(normalized);
    const passwordHash = await bcrypt.hash(NEW_PASS, 12);
    if (existing){
      console.log('Usuário já existe. Atualizando senha para teste...');
      await updateAdminUser(existing._id, { passwordHash });
      console.log('Senha atualizada.');
    } else {
      console.log('Criando usuário admin:', normalized);
      const user = await createAdminUser({ username: normalized, passwordHash, name: USERNAME, email: null, role: 'admin', active: true, createdBy: 'script' });
      console.log('Usuário criado com id:', user._id);
    }
    console.log('Credenciais de bootstrap aplicadas. A senha nao sera exibida em logs.');
    process.exit(0);
  }catch(e){
    console.error('Erro ao garantir usuário admin:', e.message || e);
    process.exit(1);
  }
})();
