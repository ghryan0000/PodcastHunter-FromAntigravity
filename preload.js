const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    transcribeAudio: (data) => ipcRenderer.invoke('transcribe-audio', data),
});

window.addEventListener('DOMContentLoaded', () => {
    console.log('PodcastHunter Desktop Shield Active');
});
