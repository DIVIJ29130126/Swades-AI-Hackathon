# Quick Start Guide - Reliable Transcription Pipeline

## For Frontend Developers

### Basic Recording + Upload

```typescript
import { useRecorder } from "@/hooks/use-recorder"
import { useReconciliation } from "@/hooks/use-reconciliation"

export default function RecorderComponent() {
  const { status, start, stop, chunks, uploadAllChunks } = useRecorder({
    chunkDuration: 5, // 5-second chunks
  })
  
  const recordingId = chunks[0]?.id // from first chunk
  const { reconcile, status: reconcStatus } = useReconciliation(recordingId)

  return (
    <div>
      {/* Recording controls */}
      <button onClick={start}>Record</button>
      <button onClick={stop}>Stop</button>

      {/* Upload all recorded chunks */}
      <button 
        onClick={uploadAllChunks}
        disabled={chunks.length === 0}
      >
        Upload All
      </button>

      {/* Show status */}
      {chunks.map(chunk => (
        <div key={chunk.chunkId}>
          #{chunk.sequenceNumber} - {chunk.acked ? "✓ Acked" : "⏳ Pending"}
          {chunk.error && <span style={{color: 'red'}}>{chunk.error}</span>}
        </div>
      ))}

      {/* Manual reconciliation */}
      {reconcStatus.isRunning && (
        <p>Recovering {reconcStatus.recovered}/{reconcStatus.totalToReconcile}</p>
      )}
    </div>
  )
}
```

### Check Upload Status

```typescript
import { getChunks } from "@/lib/api-client"

const recordingChunks = await getChunks(recordingId)
recordingChunks.forEach(chunk => {
  console.log(`Chunk ${chunk.sequenceNumber}:`, {
    uploaded: chunk.status === "uploaded",
    acked: chunk.ack?.isReconciled,
    bucketKey: chunk.bucketKey
  })
})
```

### Manual Reconciliation

```typescript
import { reconcileChunks } from "@/lib/api-client"

// Find chunks that need recovery
const result = await reconcileChunks(recordingId)
console.log(`${result.chunksNeedingReconciliation.length} chunks need re-upload`)

// The useReconciliation hook does this automatically on app load
```

---

## For Backend Developers

### Creating a Recording Session

```typescript
// POST /api/recordings/start
const recording = await fetch(':3000/api/recordings/start', {
  method: 'POST',
  body: JSON.stringify({ sessionId: 'user-123-session' })
})
const { id: recordingId } = await recording.json()
```

### Uploading a Chunk

```typescript
// POST /api/chunks/upload (multipart)
const form = new FormData()
form.append('recordingId', recordingId)
form.append('chunkId', chunkId)  // UUID from client
form.append('sequenceNumber', 0)  // 0, 1, 2, ...
form.append('duration', 5000)    // milliseconds
form.append('checksum', sha256Hash) // optional

const result = await fetch(':3000/api/chunks/upload', {
  method: 'POST',
  body: form
})
const { chunk, ack, bucketKey } = await result.json()
```

### Querying Chunk Status

```typescript
// GET /api/chunks/:recordingId - list all
const chunks = await fetch(':3000/api/chunks/abc123').then(r => r.json())

// GET /api/chunks/status/:chunkId - one chunk
const status = await fetch(':3000/api/chunks/status/uuid-123').then(r => r.json())
console.log(status.chunk.status)  // uploaded
console.log(status.ack.isReconciled)  // true/false
console.log(status.failures)  // retry history
```

### Triggering Reconciliation

```typescript
// POST /api/chunks/reconcile/:recordingId
const result = await fetch(':3000/api/chunks/reconcile/abc123', {
  method: 'POST'
})
const { chunksNeedingReconciliation } = await result.json()
// Each has: chunkId, sequenceNumber, bucketKey for re-upload
```

---

## Database Queries

### Find All Chunks for a Recording

```sql
SELECT id, chunkId, sequenceNumber, status, bucketKey 
FROM chunks 
WHERE recordingId = '12345' 
ORDER BY sequenceNumber;
```

### Track Upload Progress

```sql
SELECT 
  COUNT(*) FILTER (WHERE status = 'pending') as pending,
  COUNT(*) FILTER (WHERE status = 'uploaded') as uploaded,
  COUNT(*) FILTER (WHERE status = 'acked') as acked
FROM chunks 
WHERE recordingId = '12345';
```

### Debug Failed Uploads

```sql
SELECT 
  chunkId, 
  reason, 
  attempt, 
  nextRetryAt,
  createdAt 
FROM upload_failures 
WHERE recordingId = '12345'
ORDER BY createdAt DESC 
LIMIT 20;
```

### Check Reconciliation Status

```sql
SELECT 
  c.chunkId, 
  c.sequenceNumber,
  a.isReconciled,
  a.failureCount
FROM chunks c
LEFT JOIN chunk_acks a ON c.chunkId = a.chunkId
WHERE c.recordingId = '12345' AND a.isReconciled = false;
```

---

## Error Codes & Handling

### 400 - Missing Required Fields
```
Missing: recordingId, chunkId, sequenceNumber
→ Check client is sending all fields
```

### 404 - Recording Not Found
```
RecordingId doesn't exist in database
→ Create recording first with /api/recordings/start
```

### 500 - Server Error
```
Actual error in logs, retry with backoff
→ Client automatically retries, check server status
```

### Idempotent Uploads
```
Uploading same chunkId twice returns 200 with "already uploaded"
→ Safe to retry without creating duplicates
```

---

## Environment Setup

### `.env.local` (Next.js/web)
```bash
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### `.env` (Server)
```bash
DATABASE_URL=postgresql://user:pass@localhost/transcription
CORS_ORIGIN=http://localhost:3001
PORT=3000
```

### Database
```bash
npm run db:generate  # Generates migrations
npm run db:push     # Applies schema
npm run db:studio   # Open browser UI to inspect
```

---

## Debugging Tips

### Check OPFS in Browser
```javascript
// Console
const chunks = await opfsStorage.listChunks(recordingId)
console.table(chunks)  // See all stored chunks + status
```

### Check API Response
```javascript
// Network tab → see /api/chunks/upload responses
// Look for { chunk, ack, bucketKey } structure
```

### Database Inspection
```bash
npm run db:studio  # Opens Prisma Studio equivalent for Drizzle
# Browse recordings, chunks, chunk_acks, upload_failures tables
```

### Server Logs
```bash
# Look for:
# - "Attempt 1/5 failed, retrying..." (retry in progress)
# - "All 5 attempts failed" (permanent error)
# - "Reconciliation complete: 3 recovered, 1 failed"
```

---

## Common Scenarios

### Scenario 1: Browser Crashes During Upload
```
1. User recording → 2 chunks created + saved to OPFS
2. Browser crashes (before upload)
3. User reopens app
4. useReconciliation hook runs automatic recovery
5. Finds 2 pending chunks in OPFS
6. Re-uploads both with automatic retry
Result: ✅ No data loss
```

### Scenario 2: Network Connection Lost
```
1. Upload in progress (retry starts: 1s, 2s, 4s...)
2. Network comes back
3. Upload succeeds on retry
4. Chunk marked as acked
Result: ✅ Automatic recovery
```

### Scenario 3: Server Temporarily Down
```
1. Upload fails with 503 Service Unavailable
2. Client retries: 500ms → 1s → 2s → 4s → 8s delay
3. Server comes back up
4. Retry succeeds
5. Chunk acked
Result: ✅ Resilient to downtime
```

### Scenario 4: Bucket Lost a Chunk
```
1. Chunk uploaded & acked in DB (DB says "acked")
2. Bucket storage purges old data (bucket lost file)
3. App loads next day
4. Reconciliation detects mismatch
5. Re-uploads from OPFS (still has it)
6. DB marks isReconciled = true
Result: ✅ Detected & recovered
```

---

## Performance Tips

1. **Chunk Size**: 5-10 seconds is optimal
   - Smaller = more uploads, more overhead
   - Larger = more loss if one fails

2. **Retry Backoff**: Exponential (not linear)
   - Prevents server being hammered
   - Allows recovery from transient issues

3. **Batch Uploads**: Upload multiple chunks in parallel
   ```typescript
   await Promise.all(
     unackedChunks.map(c => uploadChunkToServer(c))
   )
   ```

4. **Database Indexes**: Already optimized
   - Queries on recordingId, status, sequence number are fast

---

## Questions?

- Check [IMPLEMENTATION.md](./IMPLEMENTATION.md) for full architecture
- Look at test examples in comments within each file
- Database schema well-documented in `packages/db/src/schema/recordings.ts`
