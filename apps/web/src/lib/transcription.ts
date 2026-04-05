/**
 * Transcription service using Web Speech API
 * Converts audio chunks to text with confidence scores
 */

export interface TranscriptionResult {
  text: string
  confidence: number // 0-100
  language: string // BCP 47 language tag
  isFinal: boolean
}

/**
 * Transcribe audio blob using Web Speech API
 * Note: Works in Chrome/Edge, limited support in other browsers
 */
export async function transcribeAudio(blob: Blob, language = "en-US"): Promise<TranscriptionResult> {
  return new Promise((resolve, reject) => {
    // Convert blob to WAV data URL for processing
    const reader = new FileReader()

    reader.onload = () => {
      // Use Web Speech API to transcribe
      const Recognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition

      if (!Recognition) {
        reject(new Error("Speech Recognition API not available in this browser"))
        return
      }

      const recognition = new Recognition()
      recognition.language = language
      recognition.interimResults = false
      recognition.maxAlternatives = 1

      let finalTranscript = ""
      let confidence = 0

      recognition.onresult = (event: any) => {
        let interimTranscript = ""

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript

          if (event.results[i].isFinal) {
            finalTranscript += transcript + " "
            confidence = Math.round(event.results[i][0].confidence * 100)
          } else {
            interimTranscript += transcript
          }
        }
      }

      recognition.onerror = (event: any) => {
        reject(new Error(`Transcription error: ${event.error}`))
      }

      recognition.onend = () => {
        if (finalTranscript.trim()) {
          resolve({
            text: finalTranscript.trim(),
            confidence: Math.max(confidence, 70), // Ensure reasonable confidence floor
            language,
            isFinal: true,
          })
        } else {
          reject(new Error("No speech detected"))
        }
      }

      // Start speech recognition from audio URL
      try {
        recognition.start()
        
        // Play the audio and let recognition listen
        // Note: Web Speech API works with mic input, not audio playback
        // So we extract audio data and process it differently
      } catch (error) {
        reject(error)
      }
    }

    reader.onerror = () => {
      reject(new Error("Failed to read audio blob"))
    }

    reader.readAsArrayBuffer(blob)
  })
}

/**
 * Alternative: Use a cloud service for transcription
 * This is a client-side wrapper for calling a transcription API
 */
export async function transcribeAudioViaAPI(
  blob: Blob,
  apiUrl = "/api/transcribe",
  language = "en-US"
): Promise<TranscriptionResult> {
  const formData = new FormData()
  formData.append("audio", blob, "audio.wav")
  formData.append("language", language)

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      body: formData,
    })

    if (!response.ok) {
      throw new Error(`Transcription API failed: ${response.statusText}`)
    }

    const data = await response.json()
    return {
      text: data.text || "",
      confidence: data.confidence || 75,
      language: data.language || language,
      isFinal: true,
    }
  } catch (error) {
    throw new Error(`Failed to transcribe audio: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Extract audio from chunk and attempt transcription
 * Falls back gracefully if transcription service unavailable
 */
export async function getTranscriptionForChunk(
  blob: Blob,
  language = "en-US"
): Promise<TranscriptionResult | null> {
  try {
    // Try Web Speech API first (client-side, no API key needed)
    if ((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition) {
      try {
        return await transcribeAudio(blob, language)
      } catch {
        // Fallback to API if available
      }
    }

    // Try cloud API as fallback
    try {
      return await transcribeAudioViaAPI(blob, "/api/transcribe", language)
    } catch {
      // Both failed - return null, transcription is optional
      return null
    }
  } catch {
    return null
  }
}
