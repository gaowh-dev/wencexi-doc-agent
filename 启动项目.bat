@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0"
title 智办通 AI 智能办公助手

echo ==========================================================
echo            智办通 AI 智能办公助手 启动器
echo ==========================================================
echo.

rem ---------- 检查 Node.js 环境 ----------
where node >nul 2>nul
if errorlevel 1 (
  echo [提示] 未检测到 Node.js 运行环境。
  echo.
  echo 将直接以静态网页方式打开页面，核心功能（分析、历史、导出）均可正常使用。
  echo 如需完整体验本地服务模式，建议安装 Node.js LTS 版（免费）：
  echo   https://nodejs.org/zh-cn
  echo.
  if exist "%~dp0public\index.html" (
    start "" "%~dp0public\index.html"
  ) else (
    echo [错误] 未找到 public\index.html，请确认项目文件完整。
  )
  pause
  exit /b 0
)

echo [1/3] 已检测到 Node.js 运行环境：
node --version
if errorlevel 1 (
  echo [错误] Node.js 无法正常运行，请重新安装 Node.js LTS 版：https://nodejs.org/
  pause
  exit /b 1
)

echo.
echo [2/3] 依赖检查：本项目为零依赖设计，无需 npm install，开箱即用。
echo.
echo [3/3] 正在启动本地服务并打开浏览器...
echo.
echo ----------------------------------------------------------
echo  访问地址：http://localhost:5173
echo  若端口被占用，会自动切换到 5174、5175 等后续端口，请注意下方提示。
echo  关闭本黑色窗口即停止服务。
echo ----------------------------------------------------------
echo.

node src\server.js
if errorlevel 1 (
  echo.
  echo [错误] 服务启动失败。
  echo   1. 请确认 src\server.js 文件存在且未被杀毒软件拦截；
  echo   2. 也可直接双击打开 public\index.html 使用静态模式。
  echo.
  pause
  exit /b 1
)
endlocal