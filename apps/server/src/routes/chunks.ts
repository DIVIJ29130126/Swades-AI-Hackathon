import { Hono } from "hono";
import { db, chunks, chunkAcks, uploadFailures } from "@my-better-t-app/db";
import { eq, and } from "drizzle-orm";

const router = new Hono();

interface UploadChunkRequest {
  recordingId: string;
  chunkId: string;
  sequenceNumber: number;
  duration: number;
  mimeType?: string;
  checksum?: string;
}

/**
 * POST /api/chunks/upload
 * Stores chunk metadata in database
 * The actual blob data should be stored in S3/bucket separately
 */
router.post("/upload", async (c) => {
  try {
    const contentType = c.req.header("content-type");

    // Parse multipart or JSON depending on content type
    let body: UploadChunkRequest & { blobSize?: number };

    if (contentType?.includes("multipart")) {
      const formData = await c.req.formData();
      body = {
        recordingId: formData.get("recordingId") as string,
        chunkId: formData.get("chunkId") as string,
        sequenceNumber: parseInt(formData.get("sequenceNumber") as string, 10),
        duration: parseInt(formData.get("duration") as string, 10),
        mimeType: (formData.get("mimeType") as string) || "audio/wav",
        checksum: formData.get("checksum") as string,
        blobSize: (formData.get("blobSize") as unknown as number) || 0,
      };
    } else {
      body = await c.req.json<UploadChunkRequest>();
    }

    // Validate required fields
    const { recordingId, chunkId, sequenceNumber, duration, mimeType = "audio/wav" } = body;

    if (!recordingId || !chunkId || sequenceNumber === undefined) {
      return c.json(
        { error: "Missing required fields: recordingId, chunkId, sequenceNumber" },
        400
      );
    }

    // Check if chunk already exists (idempotent)
    const existing = await db
      .select()
      .from(chunks)
      .where(eq(chunks.chunkId, chunkId));

    if (existing.length > 0) {
      return c.json(
        {
          message: "Chunk already uploaded",
          chunk: existing[0],
        },
        200
      );
    }

    // Generate bucket key for object storage
    const bucketKey = `recordings/${recordingId}/chunk-${sequenceNumber}-${chunkId}.wav`;

    // Insert chunk metadata
    const result = await db
      .insert(chunks)
      .values({
        recordingId,
        chunkId,
        sequenceNumber,
        duration,
        size: body.blobSize || 0,
        mimeType,
        bucketKey,
        checksum: body.checksum,
        status: "uploaded",
      })
      .returning();

    const chunk = result[0];

    if (!chunk) {
      return c.json({ error: "Failed to insert chunk" }, 500);
    }

    // Create ACK record: bucket confirmed + DB acked immediately
    // (In production, this would be split: first bucket confirms, then DB acks)
    const ackResult = await db
      .insert(chunkAcks)
      .values({
        chunkId: chunk.chunkId,
        bucketConfirmedAt: new Date(),
        dbAckedAt: new Date(),
      })
      .returning();

    if (!ackResult[0]) {
      return c.json({ error: "Failed to create chunk ack" }, 500);
    }

    return c.json(
      {
        chunk,
        ack: ackResult[0],
        bucketKey,
      },
      201
    );
  } catch (error) {
    console.error("Error uploading chunk:", error);
    return c.json({ error: "Failed to upload chunk" }, 500);
  }
});

/**
 * GET /api/chunks/:recordingId
 * Lists all chunks for a recording with ACK status
 */
router.get("/:recordingId", async (c) => {
  try {
    const recordingId = c.req.param("recordingId");

    const recordingChunks = await db
      .select()
      .from(chunks)
      .where(eq(chunks.recordingId, recordingId));

    // Fetch ACK status for each chunk
    const chunksWithAcks = await Promise.all(
      recordingChunks.map(async (chunk) => {
        const acks = await db
          .select()
          .from(chunkAcks)
          .where(eq(chunkAcks.chunkId, chunk.chunkId));

        return {
          ...chunk,
          ack: acks[0] || null,
        };
      })
    );

    return c.json(chunksWithAcks);
  } catch (error) {
    console.error("Error listing chunks:", error);
    return c.json({ error: "Failed to list chunks" }, 500);
  }
});

/**
 * GET /api/chunks/status/:chunkId
 * Gets current ACK and reconciliation status of a chunk
 */
router.get("/status/:chunkId", async (c) => {
  try {
    const chunkId = c.req.param("chunkId");

    const chunkData = await db.select().from(chunks).where(eq(chunks.chunkId, chunkId));

    if (chunkData.length === 0) {
      return c.json({ error: "Chunk not found" }, 404);
    }

    const chunk = chunkData[0];

    const acks = await db
      .select()
      .from(chunkAcks)
      .where(eq(chunkAcks.chunkId, chunkId));

    const failures = await db
      .select()
      .from(uploadFailures)
      .where(eq(uploadFailures.chunkId, chunkId));

    return c.json({
      chunk,
      ack: acks[0] || null,
      failures: failures,
    });
  } catch (error) {
    console.error("Error checking chunk status:", error);
    return c.json({ error: "Failed to check chunk status" }, 500);
  }
});

/**
 * POST /api/chunks/reconcile/:recordingId
 * Detects chunks that are acked in DB but missing from bucket
 * Returns list of chunks that need re-upload
 */
router.post("/reconcile/:recordingId", async (c) => {
  try {
    const recordingId = c.req.param("recordingId");

    // Find all acked chunks that haven't been confirmed as reconciled
    const ackedChunks = await db
      .select({
        chunk: chunks,
        ack: chunkAcks,
      })
      .from(chunks)
      .innerJoin(chunkAcks, eq(chunks.chunkId, chunkAcks.chunkId))
      .where(
        and(
          eq(chunks.recordingId, recordingId),
          eq(chunks.status, "acked"),
          eq(chunkAcks.isReconciled, false)
        )
      );

    // In a real setup, you'd check the actual bucket here
    // For now, we're trusting DB as the source of truth

    return c.json({
      recordingId,
      totalAcked: ackedChunks.length,
      chunksNeedingReconciliation: ackedChunks.map((row) => ({
        chunkId: row.chunk.chunkId,
        sequenceNumber: row.chunk.sequenceNumber,
        bucketKey: row.chunk.bucketKey,
      })),
    });
  } catch (error) {
    console.error("Error reconciling chunks:", error);
    return c.json({ error: "Failed to reconcile chunks" }, 500);
  }
});

export default router;
