@echo off
set "ROOT=%~dp0.."
set "PATH=%ROOT%\.local-tools\node-v24.14.0-win-x64;C:\Program Files\Git\cmd;%PATH%"
call "%ROOT%\.local-tools\node-v24.14.0-win-x64\npm.cmd" %*
