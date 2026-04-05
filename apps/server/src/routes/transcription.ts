import { Hono } from "hono";

const router = new Hono();

interface TranscriptionResponse {
  text: string;
  confidence: number;
  language: string;
  isFinal: boolean;
}

/**
 * POST /api/transcribe
 * Fallback transcription endpoint for when Web Speech API is unavailable
 * This is a minimal implementation - in production you'd use:
 * - Google Cloud Speech-to-Text API
 * - AWS Transcribe
 * - Azure Speech Services
 * - Whisper API
 */
router.post("/", async (c) => {
  try {
    const contentType = c.req.header("content-type");

    if (!contentType?.includes("multipart")) {
      return c.json(
        {
          error: "Expected multipart/form-data with audio blob",
        },
        400
      );
    }

    const formData = await c.req.formData();
    const audioBlob = formData.get("audio") as Blob | null;
    const language = (formData.get("language") as string) || "en-US";

    if (!audioBlob) {
      return c.json(
        {
          error: "Missing audio blob",
        },
        400
      );
    }

    // In a real implementation, you would:
    // 1. Convert blob to buffer
    // 2. Send to external transcription service (Google, AWS, etc.)
    // 3. Return the transcription result

    // For now, return a placeholder response
    // The client will fall back to Web Speech API if this fails
    const response: TranscriptionResponse = {
      text: "[Server transcription unavailable - using client-side transcription]",
      confidence: 0,
      language,
      isFinal: true,
    };

    return c.json(response);
  } catch (error) {
    console.error("Transcription error:", error);
    return c.json(
      {
        error: "Transcription service unavailable",
      },
      503
    );
  }
});

export default router;
