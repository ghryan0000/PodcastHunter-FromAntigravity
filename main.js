import { app, BrowserWindow, Menu, MenuItem, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';

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
        win.loadURL('http://localhost:3000');
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

// IPC Handler for Transcription
ipcMain.handle('transcribe-audio', async (event, { base64Audio, modelSize = 'base' }) => {
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `podcast_audio_${Date.now()}.mp3`);

    try {
        // 1. Save base64 to temp file
        const audioBuffer = Buffer.from(base64Audio, 'base64');
        fs.writeFileSync(tempFilePath, audioBuffer);

        console.log(`Saved temp audio to ${tempFilePath}`);

        // 2. Locate FFmpeg (from ffmpeg-static)
        // We'll try to find it in node_modules
        const ffmpegModulePath = path.join(__dirname, 'node_modules', 'ffmpeg-static', 'ffmpeg');
        const ffmpegPath = fs.existsSync(ffmpegModulePath) ? ffmpegModulePath : 'ffmpeg';

        // 3. Run Python transcription script
        // We use the virtual environment's python
        const venvPythonPath = path.join(__dirname, '.venv', 'bin', 'python3');
        const scriptPath = path.join(__dirname, 'transcribe.py');

        console.log(`Running transcription with ${venvPythonPath}...`);

        return new Promise((resolve, reject) => {
            const pythonProcess = spawn(venvPythonPath, [scriptPath, tempFilePath, modelSize], {
                env: {
                    ...process.env,
                    PATH: `${path.dirname(ffmpegPath)}:${process.env.PATH}`
                }
            });

            let output = '';
            let errorOutput = '';

            pythonProcess.stdout.on('data', (data) => {
                output += data.toString();
            });

            pythonProcess.stderr.on('data', (data) => {
                errorOutput += data.toString();
                console.log(`Whisper trace: ${data.toString()}`);
            });

            pythonProcess.on('close', (code) => {
                // Cleanup temp file
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

                if (code === 0) {
                    try {
                        const result = JSON.parse(output);
                        if (result.error) {
                            reject(new Error(result.error));
                        } else {
                            resolve(result.text);
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse AI output: ${output}`));
                    }
                } else {
                    reject(new Error(`AI process exited with code ${code}. Error: ${errorOutput}`));
                }
            });
        });
    } catch (error) {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        throw error;
    }
});
