const { app, BrowserWindow } = require("electron");
const path = require("node:path");

const isDev = process.env.NODE_ENV === "development";
const devUrl = process.env.RENDERER_URL || "http://127.0.0.1:5173";

function loadDevUrlWithRetry(win, retries = 10) {
  win.loadURL(devUrl).catch((error) => {
    if (retries <= 0) {
      console.error("[desktop] Failed to load renderer URL:", devUrl, error);
      return;
    }

    setTimeout(() => {
      loadDevUrlWithRetry(win, retries - 1);
    }, 500);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#f4f7fb",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.on("did-fail-load", (_event, code, description, validatedUrl) => {
    console.error("[desktop] did-fail-load", { code, description, url: validatedUrl });
  });

  if (isDev) {
    loadDevUrlWithRetry(win);
    win.webContents.openDevTools({ mode: "detach" });
    return;
  }

  win.loadFile(path.join(__dirname, "../renderer/dist/index.html"));
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
