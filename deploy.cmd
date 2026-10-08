@echo off
rem Deploys the built app (dist) to DS4/400 as BSP ZMM_MATMASS_MDG, transport DS4K915674.
rem Logon from .env (FIORI_TOOLS_USER / FIORI_TOOLS_PASSWORD). Uses the portable Node when none is on the PATH.
rem Double-click, or run in a terminal: deploy.cmd
cd /d "%~dp0"
where node >nul 2>&1 || set "PATH=C:\Users\jdr\tools\node-v24.21.0-win-x64;%PATH%"
call npm.cmd run build
if errorlevel 1 goto :fail
call npx.cmd fiori deploy --config ui5-deploy.yaml --yes
if errorlevel 1 goto :fail
echo.
echo Deploy finished.
pause
exit /b 0
:fail
echo.
echo Deploy FAILED, see the messages above.
pause
exit /b 1
