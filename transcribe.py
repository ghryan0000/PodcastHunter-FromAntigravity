import sys
import os
from faster_whisper import WhisperModel
import json

def transcribe(audio_path, model_size="base"):
    # Run on CPU for compatibility, but faster-whisper is very efficient
    # On M1/M2/M3 Macs, it can use the Apple Silicon optimizations via CTranslate2
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    segments, info = model.transcribe(audio_path, beam_size=5)

    full_text = ""
    for segment in segments:
        full_text += segment.text + " "

    return full_text.strip()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No audio path provided"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"File not found: {audio_path}"}))
        sys.exit(1)

    try:
        # Check if model size is provided
        model_size = sys.argv[2] if len(sys.argv) > 2 else "base"
        text = transcribe(audio_path, model_size)
        print(json.dumps({"text": text}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
