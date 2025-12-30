import { app, BrowserWindow, Menu, MenuItem } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#ffe4e6',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    // Enable Copy/Paste Context Menu
    win.webContents.on('context-menu', (event, params) => {
        const menu = new Menu();

        // Add Copy/Paste for input fields
        if (params.isEditable) {
            menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
            menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
            menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
            menu.append(new MenuItem({ type: 'separator' }));
            menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
        } else if (params.selectionText && params.selectionText.length > 0) {
            menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
        }

        if (menu.items.length > 0) {
            menu.popup();
        }
    });

    if (isDev) {
        win.loadURL('http://localhost:5173');
        win.webContents.openDevTools();
    } else {
        win.loadFile(path.join(__dirname, 'dist/index.html'));
    }
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
