import { Hono } from "hono";
import { env } from "@my-better-t-app/env/server";

const router = new Hono();

/**
 * Map language codes to human-readable labels
 */
function getLanguageLabel(langCode: string): string {
  const languageMap: Record<string, string> = {
    en: "🇬🇧 ENGLISH",
    fr: "🇫🇷 FRENCH",
    es: "🇪🇸 SPANISH",
    de: "🇩🇪 GERMAN",
    it: "🇮🇹 ITALIAN",
    pt: "🇵🇹 PORTUGUESE",
    ru: "🇷🇺 RUSSIAN",
    ja: "🇯🇵 JAPANESE",
    zh: "🇨🇳 CHINESE",
    hi: "🇮🇳 HINDI",
    ar: "🇸🇦 ARABIC",
    ko: "🇰🇷 KOREAN",
  };

  const code = langCode.split("-")[0] || langCode;
  return languageMap[code] || `${code.toUpperCase()}`;
}

interface TranscriptionResponse {
  text: string;
  confidence: number;
  language: string;
  languageLabel: string;
  isFinal: boolean;
}

/**
 * Transcribe using OpenAI Whisper API
 * Requires OPENAI_API_KEY environment variable
 */
async function transcribeWithWhisper(blob: Blob, language: string): Promise<TranscriptionResponse> {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const formData = new FormData();
  formData.append("file", blob, "audio.wav");
  formData.append("model", "whisper-1");
  const languageCode = language.split("-")[0] || language; // Convert en-US to en
  formData.append("language", languageCode);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Whisper API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as { text?: string; language?: string };

  // Whisper returns language code (e.g., "en", "fr")
  const detectedLanguage = data.language || language.split("-")[0] || "en";

  return {
    text: data.text || "",
    confidence: 92, // Whisper is very accurate
    language: detectedLanguage,
    languageLabel: getLanguageLabel(detectedLanguage),
    isFinal: true,
  };
}

/**
 * Transcribe using Google Cloud Speech-to-Text API
 * Requires GOOGLE_CLOUD_API_KEY environment variable
 */
async function transcribeWithGoogleCloud(
  blob: Blob,
  language: string
): Promise<TranscriptionResponse> {
  if (!env.GOOGLE_CLOUD_API_KEY) {
    throw new Error("GOOGLE_CLOUD_API_KEY not configured");
  }

  const buffer = await blob.arrayBuffer();
  const base64Audio = Buffer.from(buffer).toString("base64");

  const response = await fetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${env.GOOGLE_CLOUD_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio: { content: base64Audio },
        config: {
          encoding: "LINEAR16",
          sampleRateHertz: 16000,
          languageCode: language,
          model: "default",
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google Cloud API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as { results?: Array<{ alternatives?: Array<{ transcript?: string; confidence?: number } >; languageCode?: string }> };

  const transcript = data.results?.[0]?.alternatives?.[0]?.transcript || "";
  const confidence = Math.round((data.results?.[0]?.alternatives?.[0]?.confidence || 0.85) * 100);
  const detectedLanguage = data.results?.[0]?.languageCode || language;

  return {
    text: transcript,
    confidence,
    language: detectedLanguage,
    languageLabel: getLanguageLabel(detectedLanguage),
    isFinal: true,
  };
}

/**
 * POST /api/transcribe
 * Transcribe audio to text using real transcription services
 *
 * Priority order:
 * 1. OpenAI Whisper API (if OPENAI_API_KEY set)
 * 2. Google Cloud Speech-to-Text (if GOOGLE_CLOUD_API_KEY set)
 * 3. Error if neither is configured
 */
router.post("/", async (c) => {
  try {
    const contentType = c.req.header("content-type");

    if (!contentType?.includes("multipart")) {
      return c.json({ error: "Expected multipart/form-data with audio blob" }, 400);
    }

    const formData = await c.req.formData();
    const audioBlob = formData.get("audio") as Blob | null;
    const language = (formData.get("language") as string) || "en-US";

    if (!audioBlob) {
      return c.json({ error: "Missing audio blob" }, 400);
    }

    // Try services in order of preference
    let lastError: Error | null = null;

    if (env.OPENAI_API_KEY) {
      try {
        const result = await transcribeWithWhisper(audioBlob, language);
        return c.json(result);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn("Whisper transcription failed:", lastError.message);
      }
    }

    if (env.GOOGLE_CLOUD_API_KEY) {
      try {
        const result = await transcribeWithGoogleCloud(audioBlob, language);
        return c.json(result);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn("Google Cloud transcription failed:", lastError.message);
      }
    }

    // No API keys configured
    if (!env.OPENAI_API_KEY && !env.GOOGLE_CLOUD_API_KEY) {
      return c.json(
        {
          error: "Transcription service not configured. Set OPENAI_API_KEY or GOOGLE_CLOUD_API_KEY environment variables.",
          details: "Please configure at least one transcription service API key",
        },
        503
      );
    }

    // Both services failed
    return c.json(
      {
        error: "Transcription failed",
        details: lastError?.message || "Unknown error",
      },
      503
    );
  } catch (error) {
    console.error("Transcription endpoint error:", error);
    return c.json(
      {
        error: "Transcription service error",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

export default router;
