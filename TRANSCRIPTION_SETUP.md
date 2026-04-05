# Transcription Configuration

This project supports real transcription using either **OpenAI Whisper API** or **Google Cloud Speech-to-Text**.

## Setup Instructions

### Option 1: OpenAI Whisper API (Recommended - Easiest)

1. **Get API Key:**
   - Go to https://platform.openai.com/api-keys
   - Create a new API key
   - Set a usage limit to control costs (e.g., $50/month)

2. **Add to Environment:**
   - Create or edit `.env.local` in the root of your project
   - Add: `OPENAI_API_KEY=sk_xxx_your_key_here`

3. **Pricing:**
   - $0.02 per minute of audio (very affordable)
   - Highly accurate transcription

### Option 2: Google Cloud Speech-to-Text

1. **Setup Project:**
   - Go to https://console.cloud.google.com
   - Create a new project
   - Enable "Speech-to-Text API"
   - Create a service account and download the key

2. **Add to Environment:**
   - Create `.env.local` in the root
   - Add: `GOOGLE_CLOUD_API_KEY=your_api_key_here`

3. **Pricing:**
   - Free: 60 minutes/month
   - Paid: $0.024 per request (30-second increment)

## How It Works

```
You speak → Audio recorded in 5-second chunks
     ↓
Chunk saved locally (OPFS) + sent to server
     ↓
Server receives audio blob
     ↓
Whisper API (or Google Cloud) transcribes
     ↓
Exact transcription returned with confidence score
     ↓
Shown in UI: "Hi I am divij how are you [92% confident]"
```

## Example `.env.local`

```
# Database (required)
DATABASE_URL=postgres://user:password@localhost:5432/db

# CORS (required)
CORS_ORIGIN=http://localhost:3001

# Transcription (at least one required)
OPENAI_API_KEY=sk_xxx_your_key_here
# GOOGLE_CLOUD_API_KEY=your_api_key_here

# Node Environment
NODE_ENV=development
```

## Testing Locally

1. Make sure backend is running: `npm run dev:server`
2. Make sure frontend is running: `npm run dev:web`
3. Go to http://localhost:3001/recorder
4. **Speak English clearly**
5. After each 5-second chunk, you'll see exact transcription

## Troubleshooting

- **"Transcription service not configured"** → Add OPENAI_API_KEY or GOOGLE_CLOUD_API_KEY to .env.local
- **"API key invalid"** → Check your key is correct (no spaces, full key included)
- **"No transcription appearing"** → Open browser console (F12) to see error messages
- **"Low confidence score"** → Speak more clearly, reduce background noise

## Production Deployment (Vercel)

Set environment variables in Vercel dashboard:
1. Go to your project settings
2. Environment Variables
3. Add OPENAI_API_KEY or GOOGLE_CLOUD_API_KEY

The system will automatically use whichever API key is configured.
