@echo off
rem Minimal CLI: bin\calcool "June 20 + 3 weeks" prints the answer.
rem A batch launcher (not `npm run`) so Windows keeps quoted groups intact.
setlocal
cd /d "%~dp0.."
rem Bundle to the OS temp dir, never into the repo (avoids stale cross-branch bundles).
call "%~dp0..\node_modules\.bin\esbuild.cmd" src\cli.ts --bundle --platform=node --format=esm --outfile="%TEMP%\calcool-cli.mjs" --log-level=error
if errorlevel 1 exit /b 1
node "%TEMP%\calcool-cli.mjs" %*
