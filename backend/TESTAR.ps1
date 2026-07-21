# Script de teste rápido - OD Drive Gerador de Orçamentos
# Execute este arquivo para instalar dependências e rodar o aplicativo

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  OD Drive - Gerador de Orcamentos" -ForegroundColor Cyan
Write-Host "  Script de Teste" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Verificar se Node.js está instalado
Write-Host "[1/4] Verificando Node.js..." -ForegroundColor Yellow
$nodeVersion = node --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: Node.js nao encontrado!" -ForegroundColor Red
    Write-Host "Instale o Node.js em: https://nodejs.org/" -ForegroundColor Red
    Write-Host ""
    Read-Host "Pressione Enter para sair"
    exit 1
}
Write-Host "Node.js encontrado: $nodeVersion" -ForegroundColor Green
Write-Host ""

# Entrar no diretório do projeto
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

# Verificar se node_modules existe
Write-Host "[2/4] Verificando dependencias..." -ForegroundColor Yellow
if (-Not (Test-Path "node_modules")) {
    Write-Host "Dependencias nao encontradas. Instalando..." -ForegroundColor Yellow
    npm install
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERRO: Falha ao instalar dependencias!" -ForegroundColor Red
        Write-Host ""
        Read-Host "Pressione Enter para sair"
        exit 1
    }
    Write-Host "Dependencias instaladas com sucesso!" -ForegroundColor Green
} else {
    Write-Host "Dependencias ja instaladas." -ForegroundColor Green
}
Write-Host ""

# Limpar terminal antes de executar
Write-Host "[3/4] Preparando execucao..." -ForegroundColor Yellow
Start-Sleep -Seconds 1
Write-Host "Pronto!" -ForegroundColor Green
Write-Host ""

# Executar aplicativo
Write-Host "[4/4] Iniciando aplicacao desktop..." -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Aplicacao em execucao!" -ForegroundColor Green
Write-Host "  Pressione Ctrl+C para encerrar" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

npm run dev

# Se o app foi fechado
Write-Host ""
Write-Host "Aplicacao encerrada." -ForegroundColor Yellow
Write-Host ""
Read-Host "Pressione Enter para sair"
