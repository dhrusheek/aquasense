@echo off
REM Start the simulator with the self-running demo scenario (server must be running)
cd /d "%~dp0"
if exist "..\.venv\Scripts\python.exe" (set PY=..\.venv\Scripts\python.exe) else (set PY=python)
%PY% simulator.py --scenario demo %*
