/**
 * Transcription service for audio chunks
 * Calls server-side transcription API which uses real transcription services
 * (Whisper API or Google Cloud Speech-to-Text)
 */

export interface TranscriptionResult {
  text: string
  confidence: number // 0-100
  language: string // Language code (e.g., "en", "fr", "hi")
  languageLabel: string // Human-readable label (e.g., "ENGLISH", "FRENCH", "HINDI")
  isFinal: boolean
}

/**
 * Transcribe audio blob using server API
 * Server will use Whisper or Google Cloud based on configuration
 */
export async function transcribeAudio(blob: Blob, language = "en-US"): Promise<TranscriptionResult> {
  const formData = new FormData()
  formData.append("audio", blob, "audio.wav")
  formData.append("language", language)

  try {
    console.log("[Transcription] Starting transcription request...", { blobSize: blob.size, language })
    
    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: formData,
    })

    console.log("[Transcription] Got response:", { status: response.status, statusText: response.statusText })

    if (!response.ok) {
      const error = await response.json()
      console.error("[Transcription] Response error:", error)
      throw new Error(
        error.details || error.error || `Server returned ${response.status}: ${response.statusText}`
      )
    }

    const data = await response.json()
    console.log("[Transcription] Success:", { text: data.text?.substring(0, 50), confidence: data.confidence, language: data.language })
    
    return {
      text: data.text || "",
      confidence: data.confidence || 90,
      language: data.language || language,
      languageLabel: data.languageLabel || getLanguageLabel(data.language || language),
      isFinal: true,
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error("[Transcription] Failed:", errorMsg)
    throw new Error(`Transcription failed: ${errorMsg}`)
  }
}

/**
 * Map language codes to human-readable labels with flag emojis
 */
function getLanguageLabel(langCode: string): string {
  const languageMap: Record<string, string> = {
    "en": "🇬🇧 ENGLISH",
    "fr": "🇫🇷 FRENCH",
    "es": "🇪🇸 SPANISH",
    "de": "🇩🇪 GERMAN",
    "it": "🇮🇹 ITALIAN",
    "pt": "🇵🇹 PORTUGUESE",
    "ru": "🇷🇺 RUSSIAN",
    "ja": "🇯🇵 JAPANESE",
    "zh": "🇨🇳 CHINESE",
    "hi": "🇮🇳 HINDI",
    "ar": "🇸🇦 ARABIC",
    "ko": "🇰🇷 KOREAN",
  }
  return languageMap[langCode.split("-")[0] || langCode] || `${langCode.toUpperCase()}`
}


/**
 * Transcribe audio chunk with real transcription service
 * Returns null if transcription service is not configured
 */
export async function getTranscriptionForChunk(
  blob: Blob,
  language = "en-US"
): Promise<TranscriptionResult | null> {
  try {
    return await transcribeAudio(blob, language)
  } catch (error) {
    console.error("Transcription error:", error)
    // Return null - transcription is optional, still record the audio
    return null
  }
}
