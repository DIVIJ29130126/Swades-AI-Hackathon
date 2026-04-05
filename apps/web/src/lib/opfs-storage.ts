/**
 * OPFS (Origin Private File System) storage layer
 * Provides durable, persistent storage for recording chunks on the client
 * Chunks are not deleted until confirmed uploaded to both bucket AND database
 */

export interface StoredChunk {
  id: string;
  chunkId: string;
  recordingId: string;
  sequenceNumber: number;
  duration: number;
  timestamp: number;
  status: "pending" | "uploading" | "uploaded" | "acked";
}

class OPFSStorage {
  private rootHandle: FileSystemDirectoryHandle | null = null;
  private metadataCache: Map<string, StoredChunk[]> = new Map(); // Cache metadata to reduce file I/O

  async initialize(): Promise<void> {
    try {
      this.rootHandle = await navigator.storage.getDirectory();
    } catch (error) {
      throw new Error("Browser does not support OPFS or permission denied");
    }
  }

  /**
   * Gets or creates a directory for a recording session
   */
  private async getRecordingDir(recordingId: string): Promise<FileSystemDirectoryHandle> {
    if (!this.rootHandle) throw new Error("OPFS not initialized");

    return await this.rootHandle.getDirectoryHandle(recordingId, { create: true });
  }

  /**
   * Saves a chunk blob to OPFS with metadata
   * Returns metadata about the stored chunk
   */
  async saveChunk(
    recordingId: string,
    chunkId: string,
    sequenceNumber: number,
    blob: Blob,
    duration: number
  ): Promise<StoredChunk> {
    const dir = await this.getRecordingDir(recordingId);

    // Save the blob
    const fileName = `chunk-${sequenceNumber}-${chunkId}.wav`;
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    // Save metadata
    const metadata: StoredChunk = {
      id: `${recordingId}/${fileName}`,
      chunkId,
      recordingId,
      sequenceNumber,
      duration,
      timestamp: Date.now(),
      status: "pending",
    };

    const metaFileName = `${fileName}.meta.json`;
    const metaHandle = await dir.getFileHandle(metaFileName, { create: true });
    const metaWritable = await metaHandle.createWritable();
    await metaWritable.write(JSON.stringify(metadata));
    await metaWritable.close();

    return metadata;
  }

  /**
   * Reads a chunk blob from OPFS
   */
  async getChunk(recordingId: string, chunkId: string): Promise<Blob | null> {
    try {
      const dir = await this.getRecordingDir(recordingId);
      const entries = (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>;

      for await (const [name] of entries) {
        if (name.includes(chunkId) && name.endsWith(".wav")) {
          const fileHandle = await dir.getFileHandle(name);
          return await fileHandle.getFile();
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Lists all chunks in a recording session
   * Uses cache to reduce file I/O on repeated calls
   */
  async listChunks(recordingId: string): Promise<StoredChunk[]> {
    // Return cached metadata if available
    const cached = this.metadataCache.get(recordingId);
    if (cached) return cached;

    try {
      const dir = await this.getRecordingDir(recordingId);
      const chunks: StoredChunk[] = [];
      const entries = (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>;

      for await (const [name] of entries) {
        if (name.endsWith(".meta.json")) {
          const fileHandle = await dir.getFileHandle(name);
          const file = await fileHandle.getFile();
          const text = await file.text();
          chunks.push(JSON.parse(text));
        }
      }

      // Sort by sequence number for reliable ordering
      const sorted = chunks.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      this.metadataCache.set(recordingId, sorted); // Cache for next call
      return sorted;
    } catch {
      return [];
    }
  }

  /**
   * Updates chunk status (e.g., pending → uploading → acked)
   * Also updates cache for consistency
   */
  async updateChunkStatus(
    recordingId: string,
    chunkId: string,
    newStatus: StoredChunk["status"]
  ): Promise<void> {
    try {
      const chunks = await this.listChunks(recordingId);
      const chunk = chunks.find((c) => c.chunkId === chunkId);

      if (!chunk) return;

      const dir = await this.getRecordingDir(recordingId);
      const metaFileName = `chunk-${chunk.sequenceNumber}-${chunkId}.wav.meta.json`;
      const metaHandle = await dir.getFileHandle(metaFileName);
      const metaWritable = await metaHandle.createWritable();

      chunk.status = newStatus;
      await metaWritable.write(JSON.stringify(chunk));
      await metaWritable.close();

      // Update cache
      this.metadataCache.delete(recordingId);
    } catch {
      // Silently handle errors
    }
  }

  /**
   * Deletes a chunk ONLY after confirmed acked
   * SAFETY: Never delete before ACK confirmation
   */
  async deleteChunk(recordingId: string, chunkId: string): Promise<void> {
    try {
      const chunks = await this.listChunks(recordingId);
      const chunk = chunks.find((c) => c.chunkId === chunkId);

      if (!chunk || chunk.status !== "acked") return;

      const dir = await this.getRecordingDir(recordingId);
      const fileName = `chunk-${chunk.sequenceNumber}-${chunkId}.wav`;
      const metaFileName = `${fileName}.meta.json`;

      await dir.removeEntry(fileName);
      await dir.removeEntry(metaFileName);
      this.metadataCache.delete(recordingId);
    } catch {
      // Silently handle errors
    }
  }

  /**
   * Retrieves all unacked chunks for reconciliation
   * Used to detect and re-upload chunks that bucket lost
   */
  async getUnackedChunks(recordingId: string): Promise<StoredChunk[]> {
    const chunks = await this.listChunks(recordingId);
    return chunks.filter((c) => c.status !== "acked");
  }

  /**
   * Wipes entire recording session from OPFS
   * (Called only after all chunks acked or recording abandoned)
   */
  async deleteRecording(recordingId: string): Promise<void> {
    try {
      if (!this.rootHandle) return;
      await this.rootHandle.removeEntry(recordingId, { recursive: true });
    } catch (error) {
      console.error(`Failed to delete recording ${recordingId}:`, error);
    }
  }
}

export const opfsStorage = new OPFSStorage();
