@echo off
setlocal

git pull
npm ci & ^
npm run start

endlocal