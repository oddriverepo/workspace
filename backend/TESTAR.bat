@echo off
chcp 65001 >nul
title OD Drive - Gerador de Orçamentos

echo ========================================
echo   OD Drive - Gerador de Orçamentos
echo   Script de Teste
echo ========================================
echo.

echo [1/4] Verificando Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERRO: Node.js não encontrado!
    echo Instale o Node.js em: https://nodejs.org/
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo Node.js encontrado: %NODE_VERSION%
echo.

echo [2/4] Verificando dependências...
if not exist "node_modules" (
    echo Dependências não encontradas. Instalando...
    call npm install
    if errorlevel 1 (
        echo ERRO: Falha ao instalar dependências!
        echo.
        pause
        exit /b 1
    )
    echo Dependências instaladas com sucesso!
) else (
    echo Dependências já instaladas.
)
echo.

echo [3/4] Preparando execução...
timeout /t 1 /nobreak >nul
echo Pronto!
echo.

echo [4/4] Iniciando aplicação desktop...
echo.
echo ========================================
echo   Aplicação em execução!
echo   Pressione Ctrl+C para encerrar
echo ========================================
echo.

call npm run dev

echo.
echo Aplicação encerrada.
echo.
pause
