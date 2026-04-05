/**
 * Transcription service for audio chunks
 * Calls server-side transcription API which uses real transcription services
 * (Whisper API or Google Cloud Speech-to-Text)
 */

export interface TranscriptionResult {
  text: string
  confidence: number // 0-100
  language: string // BCP 47 language tag
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
    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(
        error.details || `Server returned ${response.status}: ${response.statusText}`
      )
    }

    const data = await response.json()
    return {
      text: data.text || "",
      confidence: data.confidence || 90,
      language: data.language || language,
      isFinal: true,
    }
  } catch (error) {
    throw new Error(`Transcription failed: ${error instanceof Error ? error.message : String(error)}`)
  }
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
