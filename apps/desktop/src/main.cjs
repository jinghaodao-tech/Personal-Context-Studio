const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
let supervisor;
async function waitForApi(url, timeoutMs = 30000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { try { const response = await fetch(url); if (response.ok) return true; } catch {} await new Promise((resolve) => setTimeout(resolve, 250)); } return false; }
function createWindow() { const window = new BrowserWindow({ width: 1280, height: 900, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } }); window.webContents.setWindowOpenHandler(() => ({ action: "deny" })); window.loadURL("http://127.0.0.1:8300/"); }
app.whenReady().then(async () => { supervisor = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev:supervisor"], { cwd: path.resolve(__dirname, "../.."), stdio: "inherit" }); if (await waitForApi("http://127.0.0.1:8300/health")) createWindow(); else { console.error("PCS API did not become ready within 30 seconds."); app.quit(); } });
app.on("window-all-closed", () => { supervisor?.kill(); if (process.platform !== "darwin") app.quit(); });
