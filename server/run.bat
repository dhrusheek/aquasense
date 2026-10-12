@echo off
REM Start the AquaSense-WSN dashboard server (http://<laptop-ip>:5050/)
cd /d "%~dp0"
if exist "..\.venv\Scripts\python.exe" (set PY=..\.venv\Scripts\python.exe) else (set PY=python)
%PY% app.py %*
