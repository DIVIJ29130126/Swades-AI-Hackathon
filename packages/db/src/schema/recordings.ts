import { pgTable, text, timestamp, serial, integer, uuid, boolean, index } from "drizzle-orm/pg-core";

/**
 * Recordings table - stores metadata about each recording session
 * No data is deleted automatically; all chunks are preserved for reliability
 */
export const recordings = pgTable(
  "recordings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: text("session_id").notNull(),
    status: text("status", { enum: ["active", "completed", "abandoned"] }).notNull().default("active"),
    totalChunks: integer("total_chunks").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_recordings_session_id").on(t.sessionId),
    index("idx_recordings_status").on(t.status),
  ],
);

/**
 * Chunks table - stores metadata for each audio chunk
 * - `chunkId`: unique identifier on client
 * - `sequenceNumber`: order within recording (for reassembly)
 * - `duration`: length of audio data in seconds
 * - `size`: byte size of the chunk data
 * - `status`: client-created, uploaded-to-bucket, acked-in-db, or reconciled
 */
export const chunks = pgTable(
  "chunks",
  {
    id: serial("id").primaryKey(),
    recordingId: uuid("recording_id")
      .references(() => recordings.id, { onDelete: "cascade" })
      .notNull(),
    chunkId: text("chunk_id").unique().notNull(), // UUID from client
    sequenceNumber: integer("sequence_number").notNull(), // order of chunks
    duration: integer("duration").notNull(), // milliseconds
    size: integer("size").notNull(), // bytes
    mimeType: text("mime_type").notNull().default("audio/wav"),
    bucketKey: text("bucket_key"), // path in object storage (e.g., "recordings/<sessionId>/chunk-<id>.wav")
    status: text("status", {
      enum: ["pending", "uploaded", "acked", "reconciled"],
    })
      .notNull()
      .default("pending"),
    checksum: text("checksum"), // SHA256 of the chunk data for integrity verification
    transcription: text("transcription"), // Transcribed text from audio
    transcriptionConfidence: integer("transcription_confidence"), // Confidence 0-100
    transcriptionLanguage: text("transcription_language").default("en-US"), // BCP 47 language tag
    transcriptionStatus: text("transcription_status", {
      enum: ["pending", "processing", "completed", "failed"],
    })
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_chunks_recording_id").on(t.recordingId),
    index("idx_chunks_chunk_id").on(t.chunkId),
    index("idx_chunks_status").on(t.status),
    index("idx_chunks_sequence").on(t.recordingId, t.sequenceNumber),
  ],
);

/**
 * Chunk acknowledgments table - tracks when bucket confirms receipt
 * This is the "ack" mentioned in the README:
 * After a chunk is uploaded to bucket, we store an ack record
 * If bucket purges but DB has ack, we reconcile by re-uploading from OPFS
 */
export const chunkAcks = pgTable(
  "chunk_acks",
  {
    id: serial("id").primaryKey(),
    chunkId: uuid("chunk_id")
      .references(() => chunks.chunkId, { onDelete: "cascade" })
      .notNull(),
    bucketConfirmedAt: timestamp("bucket_confirmed_at", { withTimezone: true }).notNull(),
    dbAckedAt: timestamp("db_acked_at", { withTimezone: true }).notNull().defaultNow(),
    isReconciled: boolean("is_reconciled").notNull().default(false),
    reconciliedAt: timestamp("reconcilied_at", { withTimezone: true }),
    failureCount: integer("failure_count").notNull().default(0),
    lastFailureReason: text("last_failure_reason"),
  },
  (t) => [
    index("idx_acks_chunk_id").on(t.chunkId),
    index("idx_acks_is_reconciled").on(t.isReconciled),
  ],
);

/**
 * Upload failures table - audit trail for all upload attempts
 * Helps debug why chunks failed and retry with exponential backoff
 */
export const uploadFailures = pgTable(
  "upload_failures",
  {
    id: serial("id").primaryKey(),
    chunkId: text("chunk_id").notNull(),
    recordingId: uuid("recording_id").notNull(),
    reason: text("reason").notNull(),
    attempt: integer("attempt").notNull(),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_upload_failures_chunk_id").on(t.chunkId),
    index("idx_upload_failures_next_retry").on(t.nextRetryAt),
  ],
);

export type Recording = typeof recordings.$inferSelect;
export type NewRecording = typeof recordings.$inferInsert;
export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;
export type ChunkAck = typeof chunkAcks.$inferSelect;
export type NewChunkAck = typeof chunkAcks.$inferInsert;
export type UploadFailure = typeof uploadFailures.$inferSelect;
export type NewUploadFailure = typeof uploadFailures.$inferInsert;
