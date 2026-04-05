import { Hono } from "hono";
import { db, recordings } from "@my-better-t-app/db";
import { eq } from "drizzle-orm";

const router = new Hono();

/**
 * POST /api/recordings/start
 * Initiates a new recording session
 */
router.post("/start", async (c) => {
  try {
    const body = await c.req.json<{ sessionId: string }>();

    if (!body.sessionId) {
      return c.json({ error: "sessionId required" }, 400);
    }

    const result = await db
      .insert(recordings)
      .values({
        sessionId: body.sessionId,
        status: "active",
      })
      .returning();

    if (!result[0]) {
      return c.json({ error: "Failed to create recording" }, 500);
    }

    return c.json(result[0]);
  } catch (error) {
    console.error("Error starting recording:", error);
    return c.json({ error: "Failed to start recording" }, 500);
  }
});

/**
 * POST /api/recordings/:recordingId/complete
 * Marks a recording as completed
 */
router.post("/:recordingId/complete", async (c) => {
  try {
    const recordingId = c.req.param("recordingId");

    const result = await db
      .update(recordings)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(recordings.id, recordingId))
      .returning();

    if (result.length === 0) {
      return c.json({ error: "Recording not found" }, 404);
    }

    return c.json(result[0]);
  } catch (error) {
    console.error("Error completing recording:", error);
    return c.json({ error: "Failed to complete recording" }, 500);
  }
});

export default router;
