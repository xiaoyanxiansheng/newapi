@echo off
cd /d C:\Users\Administrator\Desktop\Server\new-api-source
for /f "usebackq tokens=1,* delims==" %%A in (".env.test") do set "%%A=%%B"
build\new-api-hwjai.exe
