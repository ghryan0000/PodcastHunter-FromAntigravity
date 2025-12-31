import React, { useState, useEffect, useRef } from 'react';
import { Download, Music, ExternalLink, Play, Pause, AlertTriangle, FileText, Loader2, FileDown, RefreshCw, RotateCcw, RotateCw, Gauge, FileAudio } from 'lucide-react';
import { downloadFile, fetchAudioAsBase64 } from '../services/proxyService';
import { transcribeAudio } from '../services/geminiService';
import { transcribeAudioLocally } from '../services/localTranscriptionService';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

interface ResultCardProps {
  streamUrl: string;
  onReset: () => void;
  isUpload?: boolean;
  fileName?: string | null;
}

const ResultCard: React.FC<ResultCardProps> = ({ streamUrl, onReset, isUpload = false, fileName }) => {
  const [isDownloading, setIsDownloading] = useState(false);

  // Audio Player State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Transcription State
  const [transcription, setTranscription] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isGeneratingDoc, setIsGeneratingDoc] = useState(false);
  const [showManualFallback, setShowManualFallback] = useState(false);

  // Media Session API Integration
  useEffect(() => {
    if ('mediaSession' in navigator && streamUrl) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: fileName || (isUpload ? "Uploaded Audio" : "Extracted Podcast"),
        artist: "PodcastHunter",
        album: isUpload ? "Manual Upload" : "Web Scan",
        artwork: [
          { src: 'https://cdn-icons-png.flaticon.com/512/3039/3039343.png', sizes: '512x512', type: 'image/png' }
        ]
      });

      navigator.mediaSession.setActionHandler('play', togglePlay);
      navigator.mediaSession.setActionHandler('pause', togglePlay);
      navigator.mediaSession.setActionHandler('seekbackward', () => skip(-10));
      navigator.mediaSession.setActionHandler('seekforward', () => skip(10));
      navigator.mediaSession.setActionHandler('previoustrack', () => { audioRef.current && (audioRef.current.currentTime = 0); });
    }
  }, [streamUrl, fileName, isUpload]);

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }, [isPlaying]);

  // Audio Handlers
  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const skip = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime += seconds;
    }
  };

  const cycleSpeed = () => {
    if (!audioRef.current) return;
    const speeds = [1, 1.25, 1.5, 2, 0.5];
    const currentIndex = speeds.indexOf(playbackRate);
    const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
    setPlaybackRate(nextSpeed);
    audioRef.current.playbackRate = nextSpeed;
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const name = fileName || `extracted_audio_${Date.now()}.mp3`;
      await downloadFile(streamUrl, name);
    } catch (error) {
      alert("Failed to download. The file might be protected.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleTranscribe = async () => {
    setIsTranscribing(true);
    setShowManualFallback(false);
    try {
      const base64 = await fetchAudioAsBase64(streamUrl);

      const isElectron = /Electron/i.test(navigator.userAgent) && !!(window as any).electronAPI;
      let text;

      if (isElectron) {
        console.log("Electron detected: using local Whisper.");
        text = await transcribeAudioLocally(base64);
      } else {
        console.log("Web browser detected: using Gemini API.");
        // If they are on the web, they MUST use Gemini. 
        // If Gemini is out of quota, we should tell them to use the desktop app for offline mode.
        try {
          text = await transcribeAudio(base64);
        } catch (geminiError: any) {
          throw new Error(`Cloud transcription failed (likely quota exceeded). Please use the Desktop app for unlimited offline transcription!`);
        }
      }

      setTranscription(text);
    } catch (error: any) {
      console.error(error);
      const isWeb = !(/Electron/i.test(navigator.userAgent) && !!(window as any).electronAPI);
      const customMessage = isWeb
        ? `${error.message}\n\nTIP: Launch the Desktop app for offline mode!`
        : `Transcription failed: ${error.message}`;

      alert(customMessage);
      setShowManualFallback(true);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleDownloadTranscript = async () => {
    if (!transcription) return;
    setIsGeneratingDoc(true);

    try {
      const paragraphTexts = transcription.split(/\n+/).filter(line => line.trim().length > 0);

      const docChildren = [
        new Paragraph({
          text: "Audio Transcription",
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 400 },
        }),
        ...paragraphTexts.map(text => new Paragraph({
          children: [
            new TextRun({
              text: text,
              size: 24,
            })
          ],
          spacing: {
            after: 200,
            line: 360
          }
        })),
        new Paragraph({
          children: [
            new TextRun({
              text: `Generated by PodcastHunter & AudioWriter on ${new Date().toLocaleDateString()}`,
              italics: true,
              color: "888888",
              size: 20
            })
          ],
          spacing: { before: 600 }
        })
      ];

      const doc = new Document({
        sections: [{
          properties: {},
          children: docChildren,
        }],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `transcript_${Date.now()}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

    } catch (error) {
      console.error("Error generating DOCX:", error);
      alert("Failed to generate DOCX file.");
    } finally {
      setIsGeneratingDoc(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto mt-6 bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-2xl shadow-gray-200/50 mb-12 transform transition-all">
      <div className="bg-gray-50/50 p-5 border-b border-gray-100 flex justify-between items-center backdrop-blur-sm">
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          {isUpload ? <FileAudio className="w-5 h-5 text-rose-500" /> : <Music className="w-5 h-5 text-rose-500" />}
          {isUpload ? "File Ready" : "Stream Found"}
        </h3>
      </div>

      <div className="p-6 space-y-6">

        {/* Info Display */}
        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 text-sm text-gray-600 break-all flex items-center gap-3">
          {isUpload ? (
            <>
              <div className="bg-rose-100 p-2 rounded-lg text-rose-500">
                <FileAudio className="w-5 h-5" />
              </div>
              <span className="font-medium text-gray-900">{fileName || "Uploaded Audio File"}</span>
            </>
          ) : (
            <span className="font-mono text-gray-500">{streamUrl}</span>
          )}
        </div>

        {/* Audio Player Interface */}
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-lg shadow-gray-100/50">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs text-rose-500 uppercase tracking-widest font-bold flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-rose-500 animate-pulse' : 'bg-gray-300'}`}></div>
              Preview
            </span>
            <span className="text-xs font-mono font-medium text-gray-400">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <audio
            ref={audioRef}
            src={streamUrl}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={() => setIsPlaying(false)}
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            onError={() => setIsPlaying(false)}
            className="hidden"
          />

          {/* Progress Bar */}
          <div className="mb-6 relative group">
            <div className="absolute top-1/2 left-0 right-0 h-1.5 bg-gray-100 rounded-full -translate-y-1/2"></div>
            <div
              className="absolute top-1/2 left-0 h-1.5 bg-rose-500 rounded-full -translate-y-1/2 pointer-events-none transition-all duration-100"
              style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
            ></div>
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              className="relative w-full h-4 opacity-0 cursor-pointer z-10"
            />
          </div>

          {/* Playback Controls */}
          <div className="flex items-center justify-between px-2">
            {/* Speed Toggle */}
            <button
              onClick={cycleSpeed}
              className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-rose-500 transition-colors w-16 group"
              title="Playback Speed"
            >
              <Gauge className="w-4 h-4" />
              <span>{playbackRate}x</span>
            </button>

            {/* Main Transport */}
            <div className="flex items-center gap-8">
              <button
                onClick={() => skip(-10)}
                className="text-gray-400 hover:text-gray-800 p-2 rounded-full transition-colors"
                title="Rewind 10s"
              >
                <RotateCcw className="w-6 h-6" />
              </button>

              <button
                onClick={togglePlay}
                className="bg-rose-500 hover:bg-rose-600 text-white p-4 rounded-full shadow-xl shadow-rose-500/30 transition-all hover:scale-105 active:scale-95"
              >
                {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current pl-1" />}
              </button>

              <button
                onClick={() => skip(10)}
                className="text-gray-400 hover:text-gray-800 p-2 rounded-full transition-colors"
                title="Forward 10s"
              >
                <RotateCw className="w-6 h-6" />
              </button>
            </div>

            {/* Placeholder to balance layout */}
            <div className="w-16"></div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl font-bold text-white transition-all shadow-lg
              ${isDownloading
                ? 'bg-rose-400 cursor-not-allowed shadow-none'
                : 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/30 hover:shadow-rose-500/40 active:scale-95'}`}
          >
            {isDownloading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                Downloading...
              </span>
            ) : (
              <>
                <Download className="w-5 h-5" />
                Download {isUpload ? "File" : "MP3"}
              </>
            )}
          </button>

          {!isUpload && (
            <a
              href={streamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 border border-transparent transition-all active:scale-95"
            >
              <ExternalLink className="w-4 h-4" />
              Open Link
            </a>
          )}
        </div>

        {/* Transcription Section */}
        <div className="border-t border-gray-100 pt-8 mt-2">
          <div className="flex items-center justify-between mb-5">
            <h4 className="text-gray-900 font-bold flex items-center gap-2 text-lg">
              <div className="bg-purple-100 p-1.5 rounded-lg">
                <FileText className="w-5 h-5 text-purple-600" />
              </div>
              Transcription
            </h4>
            {!transcription && !isTranscribing && (
              <button
                onClick={handleTranscribe}
                className="text-xs font-semibold bg-purple-50 text-purple-600 border border-purple-100 px-4 py-2 rounded-full hover:bg-purple-100 transition-colors flex items-center gap-1.5 shadow-sm"
              >
                Generate Speech-to-text (AI)
              </button>
            )}
          </div>

          {isTranscribing && (
            <div className="bg-gray-50 rounded-xl p-8 flex flex-col items-center justify-center text-gray-500 gap-3 border border-gray-100">
              <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
              <span className="text-sm font-medium">
                {!!(window as any).electronAPI ? "AI is listening offline..." : "AI is listening via Cloud..."}
              </span>
              {!!(window as any).electronAPI && <p className="text-xs text-gray-400 mt-1">First run may take a moment to load models</p>}
            </div>
          )}

          {showManualFallback && !transcription && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-6 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0 text-orange-600 mt-0.5" />
                <div className="flex-1">
                  <h5 className="font-bold text-orange-900 mb-4">Transcription Support</h5>

                  {/* Option A */}
                  <div className="mb-6 pb-6 border-b border-orange-200/50">
                    <h6 className="text-xs font-bold uppercase tracking-wider text-orange-700 mb-2">Option A: Switch to Desktop (Recommended)</h6>
                    <p className="text-sm text-orange-800 leading-relaxed mb-3">
                      Unlock unlimited **Offline AI** by launching the local app window:
                    </p>
                    <div className="bg-orange-100/50 p-3 rounded-lg border border-orange-200 font-mono text-[10px] text-orange-900 select-all overflow-x-auto">
                      cd "/Users/ryanchang/Files in Mac mini/PodcastHunter-FromAntigravity" && npm run desktop
                    </div>
                  </div>

                  {/* Option B */}
                  <div>
                    <h6 className="text-xs font-bold uppercase tracking-wider text-orange-700 mb-2">Option B: Manual Transcription</h6>
                    <ol className="text-sm text-orange-900 space-y-1.5 list-decimal list-inside mb-4 opacity-90">
                      <li>Download the audio file above</li>
                      <li>Use an external transcription tool</li>
                      <li>Paste the result below</li>
                    </ol>

                    <textarea
                      value={transcription || ''}
                      onChange={(e) => setTranscription(e.target.value)}
                      placeholder="Paste your text here..."
                      className="w-full h-32 bg-white border border-orange-300 rounded-lg p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 resize-y leading-relaxed"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {transcription && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="relative">
                <textarea
                  readOnly
                  value={transcription}
                  className="w-full h-48 bg-white border border-gray-200 rounded-xl p-4 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 resize-y leading-relaxed shadow-sm"
                />
                <div className="absolute top-2 right-2 px-2 py-1 bg-gray-100 rounded text-xs text-gray-500 font-medium pointer-events-none">
                  Preview
                </div>
              </div>

              <button
                onClick={handleDownloadTranscript}
                disabled={isGeneratingDoc}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-900 hover:bg-black text-white font-semibold transition-all shadow-lg shadow-gray-200 active:scale-95 disabled:opacity-70 disabled:scale-100"
              >
                {isGeneratingDoc ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileDown className="w-4 h-4" />
                )}
                Download Word Doc (.docx)
              </button>
            </div>
          )}
        </div>

        {!isUpload && (
          <div className="flex items-start gap-3 p-4 bg-orange-50 border border-orange-100 rounded-xl text-xs text-orange-800">
            <AlertTriangle className="w-5 h-5 shrink-0 text-orange-500" />
            <p className="leading-relaxed">
              <strong>Note:</strong> If the download fails, the server might enforce strict CORS policies.
              Try the "Open Link" button to view the file in a new tab, then save it from there.
            </p>
          </div>
        )}

        {/* Separate Clear Scan Another Button */}
        <div className="pt-6 border-t border-gray-100">
          <button
            onClick={onReset}
            className="w-full py-4 rounded-xl border-2 border-dashed border-gray-200 hover:border-rose-400 hover:bg-rose-50 text-gray-400 hover:text-rose-600 transition-all group flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-5 h-5 group-hover:rotate-180 transition-transform duration-500" />
            <span className="font-semibold">{isUpload ? "Upload Another File" : "Scan Another Website"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResultCard;