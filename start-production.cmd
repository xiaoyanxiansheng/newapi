@echo off
cd /d C:\Users\Administrator\Desktop\Server\new-api-source
for /f "usebackq tokens=1,* delims==" %%A in (".env.production") do set "%%A=%%B"
build\new-api-hwjai.exe >> production.stdout.log 2>> production.stderr.log
