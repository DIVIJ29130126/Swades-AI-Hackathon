/**
 * API client for uploading chunks and managing recordings
 * Handles all communication between frontend and Hono backend
 * Every operation has automatic retry with exponential backoff
 */

import { retryWithBackoff } from "./retry-utils";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export interface ChunkResponse {
  chunk: {
    id: number;
    recordingId: string;
    chunkId: string;
    sequenceNumber: number;
    duration: number;
    size: number;
    mimeType: string;
    bucketKey: string;
    status: string;
    checksum?: string;
  };
  ack: {
    id: number;
    bucketConfirmedAt: string;
    dbAckedAt: string;
    isReconciled: boolean;
  };
  bucketKey: string;
}

export interface RecordingResponse {
  id: string;
  sessionId: string;
  status: "active" | "completed" | "abandoned";
  totalChunks: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Start a new recording session
 * With automatic retry on network failures
 */
export async function startRecording(sessionId: string): Promise<RecordingResponse> {
  return retryWithBackoff(async () => {
    const response = await fetch(`${API_BASE}/api/recordings/start`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Connection": "keep-alive",
      },
      body: JSON.stringify({ sessionId }),
    });

    if (!response.ok) {
      throw new Error(`Failed to start recording: ${response.statusText}`);
    }

    return response.json();
  });
}

/**
 * Complete a recording session
 */
export async function completeRecording(recordingId: string): Promise<RecordingResponse> {
  return retryWithBackoff(async () => {
    const response = await fetch(`${API_BASE}/api/recordings/${recordingId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Failed to complete recording: ${response.statusText}`);
    }

    return response.json();
  });
}

/**
 * Upload a chunk - stores metadata in DB
 * Returns chunk data with bucket location
 * This is the critical operation - retried aggressively
 */
export async function uploadChunk(
  recordingId: string,
  chunkId: string,
  sequenceNumber: number,
  duration: number,
  blob: Blob,
  checksum?: string
): Promise<ChunkResponse> {
  return retryWithBackoff(
    async () => {
      const formData = new FormData();
      formData.append("recordingId", recordingId);
      formData.append("chunkId", chunkId);
      formData.append("sequenceNumber", sequenceNumber.toString());
      formData.append("duration", duration.toString());
      formData.append("mimeType", blob.type || "audio/wav");
      formData.append("blobSize", blob.size.toString());
      formData.append("blobData", blob);

      if (checksum) {
        formData.append("checksum", checksum);
      }

      const response = await fetch(`${API_BASE}/api/chunks/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Failed to upload chunk: ${response.statusText}`);
      }

      return response.json();
    },
    {
      maxAttempts: 3,
      initialDelayMs: 50,
      maxDelayMs: 1000,
      backoffMultiplier: 2,
    }
  );
}

/**
 * Get all chunks for a recording with their ACK status
 */
export async function getChunks(
  recordingId: string
): Promise<
  Array<{
    id: number;
    chunkId: string;
    sequenceNumber: number;
    duration: number;
    status: string;
    ack?: { isReconciled: boolean; bucketConfirmedAt: string; dbAckedAt: string };
  }>
> {
  return retryWithBackoff(async () => {
    const response = await fetch(`${API_BASE}/api/chunks/${recordingId}`, {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`Failed to get chunks: ${response.statusText}`);
    }

    return response.json();
  });
}

/**
 * Get status of a specific chunk
 */
export async function getChunkStatus(chunkId: string) {
  return retryWithBackoff(async () => {
    const response = await fetch(`${API_BASE}/api/chunks/status/${chunkId}`, {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`Failed to get chunk status: ${response.statusText}`);
    }

    return response.json();
  });
}

/**
 * Reconcile chunks for a recording
 * Detects chunks that are acked in DB but might be missing from bucket
 */
export async function reconcileChunks(recordingId: string) {
  return retryWithBackoff(async () => {
    const response = await fetch(`${API_BASE}/api/chunks/reconcile/${recordingId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Failed to reconcile chunks: ${response.statusText}`);
    }

    return response.json();
  });
}

/**
 * Compute SHA256 checksum of blob for integrity verification
 */
export async function computeChecksum(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
