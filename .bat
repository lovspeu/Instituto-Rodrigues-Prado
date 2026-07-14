@echo off
title INSTITUTO

:: ENTRA NA PASTA DO PROJETO
cd /d "%~dp0"

:: INICIA O SERVIDOR
start "Servidor" cmd /k "node server.js"

:: ESPERA
timeout /t 5 /nobreak >nul

:: INICIA O NGROK
start "Ngrok" cmd /k "ngrok http 3000"

:: ESPERA
timeout /t 5 /nobreak >nul

:: ABRE NO BRAVE
start brave "http://localhost:3000"

exit