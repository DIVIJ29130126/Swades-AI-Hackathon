import { useCallback, useEffect, useRef, useState } from "react"
import { opfsStorage } from "@/lib/opfs-storage"
import { reconcileChunks, uploadChunk, computeChecksum } from "@/lib/api-client"

export interface ReconciliationStatus {
  isRunning: boolean
  totalToReconcile: number
  recovered: number
  failed: number
  lastError?: string
}

/**
 * Hook to detect and recover from chunk upload failures
 * Runs reconciliation:
 * 1. On app load (detect chunks that were acked but bucket lost)
 * 2. Periodically during recording
 * 3. When network is restored
 */
export function useReconciliation(recordingId: string | null) {
  const [status, setStatus] = useState<ReconciliationStatus>({
    isRunning: false,
    totalToReconcile: 0,
    recovered: 0,
    failed: 0,
  })

  const reconciliationRef = useRef<AbortController | null>(null)

  /**
   * Main reconciliation function
   * Finds unacked chunks in OPFS and re-uploads them
   */
  const reconcile = useCallback(async () => {
    if (!recordingId) return

    if (status.isRunning) {
      console.log("Reconciliation already in progress")
      return
    }

    setStatus((s) => ({ ...s, isRunning: true }))

    try {
      reconciliationRef.current = new AbortController()
      const signal = reconciliationRef.current.signal

      // Get unacked chunks from OPFS
      const unackedChunks = await opfsStorage.getUnackedChunks(recordingId)

      if (unackedChunks.length === 0) {
        console.log("No chunks need reconciliation")
        setStatus((s) => ({ ...s, isRunning: false }))
        return
      }

      setStatus((s) => ({
        ...s,
        totalToReconcile: unackedChunks.length,
        recovered: 0,
        failed: 0,
      }))

      console.log(`Starting reconciliation for ${unackedChunks.length} chunks`)

      // Try to re-upload each unacked chunk
      let recovered = 0
      let failed = 0

      for (const storedChunk of unackedChunks) {
        if (signal.aborted) break

        try {
          // Retrieve blob from OPFS
          const blob = await opfsStorage.getChunk(recordingId, storedChunk.chunkId)

          if (!blob) {
            console.warn(`Chunk ${storedChunk.chunkId} no longer in OPFS`)
            failed++
            continue
          }

          // Compute checksum
          const checksum = await computeChecksum(blob)

          // Re-upload with exponential backoff
          let retries = 0
          const maxRetries = 3
          let lastError: Error | null = null

          while (retries < maxRetries && !signal.aborted) {
            try {
              await uploadChunk(
                recordingId,
                storedChunk.chunkId,
                storedChunk.sequenceNumber,
                storedChunk.duration,
                blob,
                checksum
              )

              // Mark as acked in OPFS
              await opfsStorage.updateChunkStatus(recordingId, storedChunk.chunkId, "acked")
              recovered++
              console.log(`✓ Recovered chunk ${storedChunk.chunkId}`)
              break
            } catch (error) {
              lastError = error as Error
              retries++

              if (retries < maxRetries) {
                // Exponential backoff: 1s, 2s, 4s
                const backoffMs = Math.pow(2, retries - 1) * 1000
                console.log(
                  `Retry ${retries}/${maxRetries} for chunk ${storedChunk.chunkId} after ${backoffMs}ms`
                )
                await new Promise((resolve) => setTimeout(resolve, backoffMs))
              }
            }
          }

          if (lastError && retries === maxRetries) {
            failed++
            console.error(`✗ Failed to recover chunk ${storedChunk.chunkId}:`, lastError)
          }
        } catch (error) {
          console.error(`Error processing chunk ${storedChunk.chunkId}:`, error)
          failed++
        }

        // Update status
        setStatus((s) => ({
          ...s,
          recovered,
          failed,
        }))
      }

      setStatus((s) => ({
        ...s,
        isRunning: false,
        lastError: failed > 0 ? `Failed to recover ${failed} chunks` : undefined,
      }))

      console.log(
        `Reconciliation complete: ${recovered} recovered, ${failed} failed`
      )
    } catch (error) {
      console.error("Reconciliation error:", error)
      setStatus((s) => ({
        ...s,
        isRunning: false,
        lastError: String(error),
      }))
    }
  }, [recordingId])

  /**
   * Cancel ongoing reconciliation
   */
  const cancel = useCallback(() => {
    if (reconciliationRef.current) {
      reconciliationRef.current.abort()
      setStatus((s) => ({ ...s, isRunning: false }))
    }
  }, [])

  /**
   * Run reconciliation on app load to recover from crashes
   */
  useEffect(() => {
    if (recordingId && !status.isRunning) {
      // Small delay to let UI settle
      const timer = setTimeout(() => {
        reconcile()
      }, 1000)

      return () => clearTimeout(timer)
    }
  }, [recordingId])

  return { status, reconcile, cancel }
}
