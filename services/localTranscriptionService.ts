export async function transcribeAudioLocally(base64Audio: string, modelSize: string = 'base'): Promise<string> {
    const electronAPI = (window as any).electronAPI;

    if (!electronAPI || !electronAPI.transcribeAudio) {
        throw new Error("Electron API not available. Local transcription only works in the desktop app.");
    }

    try {
        const text = await electronAPI.transcribeAudio({ base64Audio, modelSize });
        return text || "No transcription available.";
    } catch (error: any) {
        console.error("Local Transcription Error:", error);
        throw new Error(`Local transcription failed: ${error.message || error}`);
    }
}
