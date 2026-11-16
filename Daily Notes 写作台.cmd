@echo off
setlocal
set "REST_MODE_LAUNCHER=%~dp0tools\daily-studio\launch.mjs"
set "REST_MODE_LAUNCH_OPTION=%~1"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$n=Get-Command node.exe -ErrorAction SilentlyContinue; if($n){$exe=$n.Source}else{$p=Get-AppxPackage -Name 'OpenAI.CodexPrimaryRuntime*' | Sort-Object Version -Descending | Select-Object -First 1; if(-not $p){throw 'Node.js 24 was not found. Please install it from nodejs.org.'}; $exe=Join-Path $p.InstallLocation 'dependencies\node\bin\node.exe'}; if($env:REST_MODE_LAUNCH_OPTION -eq '--no-browser'){& $exe $env:REST_MODE_LAUNCHER --no-browser}else{& $exe $env:REST_MODE_LAUNCHER}; exit $LASTEXITCODE"
if errorlevel 1 pause
endlocal
