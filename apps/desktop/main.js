// Mizan POS - Electron main process.
// Loads the built Angular bundle (../frontend/dist/frontend/browser) in production,
// or the Angular dev server when MIZAN_DEV_URL is set.
const { app, BrowserWindow, Menu, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DEV_URL = process.env.MIZAN_DEV_URL || '';
const INDEX_FILE = path.join(__dirname, '..', 'frontend', 'dist', 'frontend', 'browser', 'index.html');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#f4f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Open external links in the system browser, never inside the POS shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else if (fs.existsSync(INDEX_FILE)) {
    win.loadFile(INDEX_FILE);
  } else {
    win.loadURL(
      'data:text/html,<h2 style="font-family:sans-serif">Frontend bundle not found.<br/>Run: npm run build -w @mizan/frontend</h2>',
    );
  }
}

app.whenReady().then(() => {
  // Minimal menu for kiosk-style use.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );

  // Deny all permission requests (camera, geolocation, ...) - the POS needs none.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
