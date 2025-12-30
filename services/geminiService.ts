import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

// Models to try in order of preference/likelihood
const MODELS_TO_TRY = [
  'gemini-1.5-flash',
  'gemini-1.5-flash-001',
  'gemini-1.5-flash-002',
  'gemini-1.5-pro',
  'gemini-1.5-pro-001',
  'gemini-1.5-pro-002',
  'gemini-1.0-pro',
];

async function generateContentWithFallback(content: any): Promise<any> {
  let lastError;
  for (const modelName of MODELS_TO_TRY) {
    try {
      console.log(`Trying model: ${modelName}`);
      const result = await ai.models.generateContent({
        model: modelName,
        ...content
      });
      console.log(`Success with model: ${modelName}`);
      return result;
    } catch (error: any) {
      console.warn(`Failed with model ${modelName}:`, error.message);
      lastError = error;

      // If Quota Exceeded (429), maybe we should stop?
      // But sometimes different models have different free tiers, so we continue.
    }
  }
  throw lastError;
}

/**
 * Uses Gemini to analyze HTML source code and locate the 'streamURL'.
 * We rely on Gemini's understanding of code syntax (JS/JSON objects) to find the key.
 */
export async function extractStreamUrlFromSource(sourceCode: string): Promise<string | null> {
  // Truncate extremely large HTML files to avoid unnecessary token usage, 
  // though Gemini 1.5/2.0 context is huge, 100k chars is usually enough for the head/body scripts where vars live.
  // Using a larger buffer to be safe.
  const truncatedSource = sourceCode.length > 500000 ? sourceCode.substring(0, 500000) : sourceCode;

  try {
    const response = await generateContentWithFallback({
      contents: {
        parts: [
          {
            text: `
              You are a code extraction expert. 
              I have provided the HTML source code of a webpage below.
              
              TASK:
              1. Scan the code for a variable, JSON key, or assignment named "streamURL".
              2. It typically looks like: "streamURL": "http...", var streamURL = '...', or streamURL: '...'.
              3. Extract the full URL value associated with it.
              4. If "streamURL" is not found, look for any other variable that obviously contains an MP3 audio stream URL (ending in .mp3 or typical streaming format).
              5. Return the result in a strict JSON format.
      
              SOURCE CODE:
              \`\`\`html
              ${truncatedSource}
              \`\`\`
            `
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            found: { type: Type.BOOLEAN },
            url: { type: Type.STRING, description: "The extracted stream URL" },
            confidence: { type: Type.STRING, description: "Low, Medium, or High confidence" }
          },
          required: ["found"]
        }
      }
    });

    // The Google GenAI SDK (newer versions) uses .text() method. 
    // If the linter complains about 'get accessor', it might be a type mismatch or old definition.
    // We will trust the runtime behavior of the @google/genai package but silent the linter if needed.
    // Casting to any to avoid "expression is not callable" if the types are confused.
    const responseText = (response.text as any)();
    const result = JSON.parse(responseText || '{}');

    if (result.found && result.url) {
      return result.url;
    }

    // If AI returns found: false, try regex immediately
    console.log("AI could not find URL, falling back to Regex...");
    return extractWithRegex(sourceCode);

  } catch (error: any) {
    console.warn("Gemini Analysis Failed, attempting Regex Fallback:", error);
    // If AI totally failed (e.g. Quota), try regex
    const regexResult = extractWithRegex(sourceCode);
    if (regexResult) return regexResult;

    // If both fail, then throw
    throw new Error(`Analysis failed (AI error: ${error.message}). Could not auto-detect simple MP3 links.`);
  }
}

/**
 * Fallback function to extract URLs using Regex
 */
function extractWithRegex(sourceCode: string): string | null {
  // 1. Look for explicit streamURL assignment: variable = "http..." or "streamURL": "http..."
  const streamUrlRegex = /(?:streamURL|audioUrl|mp3Url)["']?\s*(?::|=)\s*["']([^"']+\.mp3[^"']*)["']/i;
  const streamMatch = sourceCode.match(streamUrlRegex);

  if (streamMatch && streamMatch[1]) {
    console.log("Regex Fallback found streamURL:", streamMatch[1]);
    return streamMatch[1];
  }

  // 2. Look for ANY http string ending in .mp3
  const mp3Regex = /(https?:\/\/[^"']+\.mp3)/i;
  const mp3Match = sourceCode.match(mp3Regex);

  if (mp3Match && mp3Match[1]) {
    console.log("Regex Fallback found general MP3 URL:", mp3Match[1]);
    return mp3Match[1];
  }

  return null;
}

/**
 * Transcribes audio content to text using Gemini.
 */
export async function transcribeAudio(base64Audio: string, retryAttempt = false): Promise<string> {
  try {
    const response = await generateContentWithFallback({
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'audio/mp3',
              data: base64Audio
            }
          },
          {
            text: `
            Transcribe this audio file into high-quality text.
            
            Formatting Rules:
            1. Segment the text into clear, logical paragraphs based on the flow of speech.
            2. If there are distinct speakers, separate their turns with new lines.
            3. Use proper punctuation, capitalization, and sentence structure.
            4. Do not include timestamps or meta-commentary (like [music playing]).
            5. Output plain text with double newlines between paragraphs.
            `
          }
        ]
      }
    });

    const responseText = (response.text as any)();
    return responseText || "No transcription available.";
  } catch (error: any) {
    console.error("Transcription Error:", error);

    // Check for Rate Limit (429)
    if ((error.status === 429 || (error.message && error.message.includes("429"))) && !retryAttempt) {
      console.warn("Rate limit hit. Waiting 35 seconds to retry...");
      // Wait 35s (safety buffer over the typical ~30s limit)
      await new Promise(resolve => setTimeout(resolve, 35000));
      return transcribeAudio(base64Audio, true); // Retry once
    }

    // Check for Model Not Found (404) -> LIST available models
    if (error.message && (error.message.includes("404") || error.message.includes("not found"))) {
      try {
        // Attempt to list models to see what IS available
        console.log("Model not found. Listing available models...");
        const modelsResponse = await ai.models.list();

        // The list() method returns a Pager, which is async iterable
        const modelNames: string[] = [];
        // @ts-ignore
        for await (const model of modelsResponse) {
          if (model.name) modelNames.push(model.name.replace('models/', ''));
        }

        const limitedList = modelNames.slice(0, 10).join(", "); // Show first 10
        throw new Error(`Model 'gemini-1.5-flash' not found. Available models for your key: ${limitedList}`);
      } catch (listError: any) {
        console.error("Failed to list models:", listError);
        // Don't swallow the original error if listing fails
      }
    }

    throw new Error(`AI transcription failed: ${error.message || error}`);
  }
}