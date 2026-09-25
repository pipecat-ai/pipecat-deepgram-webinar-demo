# Deepgram Flux Voice Agent

A restaurant reservation voice agent built with [Pipecat](https://github.com/pipecat-ai/pipecat), using [Deepgram Flux](https://developers.deepgram.com) for both speech-to-text and text-to-speech.

```
Deepgram Flux (STT) → GPT-5.6 Luna (LLM) → Deepgram Flux (TTS)
```

- **Flux STT** transcribes the caller and decides when they've finished speaking, using one model for both, so the bot needs no separate VAD or turn detector.
- **Flux TTS** streams LLM tokens straight into synthesis and keeps the voice's prosody consistent across turns.
- **Tools**: the agent looks up, creates, and updates reservations against an in-memory store, and hangs up when the caller is done.

The web client is a Vite + React app built from [Pipecat UI](https://ui.pipecat.ai) components (installed through the shadcn registry). It shows a live transcript, per-service latency metrics, and a counter for each tool call.

## Prerequisites

- [uv](https://docs.astral.sh/uv/) and Node.js 22+
- A [Deepgram API key](https://console.deepgram.com) with Flux access
- An OpenAI API key, for GPT-5.6 Luna

## Run it locally

### 1. Start the bot

```bash
cd server
cp .env.example .env    # add DEEPGRAM_API_KEY and OPENAI_API_KEY
uv sync
uv run bot.py
```

The bot listens on http://localhost:7860.

### 2. Start the client

In a second terminal:

```bash
cd client
npm install
npm run dev
```

Open http://localhost:5173 and allow microphone access. Pick your microphone and speakers, then press **Connect**. The Vite dev server proxies `/api/offer` to the bot on port 7860.

Try:

- "Can you check my reservation? It's under Alice Smith." (a booking seeded for tomorrow)
- "Book a table for four tomorrow at 7pm under Bob Jones."
- "Actually, make that five people."
- "What are you built with?"
- "That's all, thanks. Bye!" (the agent says goodbye and hangs up)

## How it works

### Server (`server/`)

| File              | What it does                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `bot.py`          | The pipeline: transport → Flux STT → context aggregator → Luna → Flux TTS → transport. Also the system prompt and the transports.           |
| `tools.py`        | `get_reservation`, `create_reservation`, `update_reservation`, and `end_call`, written as direct functions (the signature and docstring are the schema). |
| `evals/`          | Behavioral evals that drive the bot headless (see [Testing](#testing)).                                                                    |
| `pcc-deploy.example.toml` | Example Pipecat Cloud deployment config, with Krisp VIVA voice isolation enabled. Copy it to `pcc-deploy.toml`.                  |

**Turn detection.** Flux proposes each turn boundary and installs Pipecat's `ExternalUserTurnStrategies` itself, so the pipeline has no VAD, Smart Turn, or other turn analyzer. Adding one would give you two detectors disagreeing about when the caller has finished. To tune turn-taking, adjust Flux's settings on `DeepgramFluxSTTService`:

- `eot_threshold`: end-of-turn confidence (default 0.7). Lower values end turns sooner.
- `eot_timeout_ms`: ends a turn after this much silence, whatever the confidence (default 5000).
- `enable_eager_end_of_turn=True` with `eager_eot_threshold`: starts generating on Flux's early end-of-turn prediction and holds the response until the turn is confirmed. This lowers latency at the cost of some discarded LLM calls.

**LLM.** GPT-5.6 Luna runs over the OpenAI Responses API WebSocket, with reasoning effort set to `none` to minimize time to first token. Set `OPENAI_MODEL` to try another model.

**Voice.** The default Flux voice is `flux-heather-en`. Set `DEEPGRAM_VOICE` to use another, such as `flux-cole-en`.

### Client (`client/`)

| Path                              | What it is                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/App.tsx`                     | The session layout: agent orb, transcript, tool-call counters, and metrics.                                           |
| `src/components/connect-screen.tsx` | The screen before a call: microphone and speaker pickers plus a connect button, from Pipecat UI. |
| `src/components/pipecat/`         | Pipecat UI components from the `@pipecat` shadcn registry (`npx shadcn add @pipecat/<name>`), some restyled for the terminal look. |
| `src/hooks/use-tool-calls.ts`     | Counts each tool call from the bot's RTVI events, and plays the chime.                                                |
| `src/lib/session-config.ts`       | Picks the transport: SmallWebRTC against a local bot in dev, Daily against Pipecat Cloud in production.               |
| `api/start.ts`                    | `POST /api/start`: starts a Pipecat Cloud session without exposing the API key to the browser. Deployed as a Vercel function, and served by the Vite dev and preview servers locally. |

The metrics panel filters by the bot's processor names (`llm`, `tts`), so each service's latency reads separately:

- **LLM TTFAT / TTFB / processing**: time to the first answer token, time to the first output chunk, and total inference time.
- **TTS TTFA / TTFB**: time from a synthesis request to the first audible sample, and to the first audio bytes.
- **TTS chars / LLM tokens**: cumulative usage for the session.

## Testing

The bot ships with a text-mode eval that sends the caller's lines as text, bypassing STT and TTS. It checks that each tool is called with the right arguments. The checks are deterministic, so no judge LLM is needed. From `server/`:

```bash
uv run pipecat eval suite evals/manifest.yaml
```

The suite starts a fresh bot for each scenario. To iterate faster, keep one bot running and drive the scenario at it:

```bash
uv run bot.py -t eval                                          # terminal 1
uv run pipecat eval run evals/scenarios/reservations.yaml -v   # terminal 2
```

## Deploying

### Bot: Pipecat Cloud

You'll need a [Pipecat Cloud account](https://pipecat.daily.co) and the CLI (`uv tool install "pipecat-ai[cli]"`). From `server/`:

```bash
cp pcc-deploy.example.toml pcc-deploy.toml   # then edit agent name, scaling, etc.
pipecat cloud auth login
pipecat cloud secrets set deepgram-webinar-demo-secrets --file .env
pipecat cloud deploy
pipecat cloud agent status deepgram-webinar-demo
```

`pipecat cloud deploy` builds the image in the cloud from the `Dockerfile` and applies `pcc-deploy.toml`. That enables Krisp VIVA with the `pro` model (the WebRTC model, for browser audio). Krisp only runs on Pipecat Cloud: the bot skips its filter when you run it locally.

After changing the secret set, redeploy (`pipecat cloud deploy --force`) so running agents pick up the new values. `min_agents` sets how many agents stay warm; raise it before a live event.

### Client

The client reaches the deployed agent over Daily. It posts to `/api/start`, which starts a session with your Pipecat Cloud public key and returns only the room to join. That endpoint needs two server-side variables. Get the public key from `pipecat cloud organizations keys`:

```
BOT_START_URL=https://api.pipecat.daily.co/v1/public/deepgram-webinar-demo/start
BOT_START_PUBLIC_KEY=pk_...
```

**Locally:** put both in `client/.env` along with `VITE_TRANSPORT=daily`, then `npm run dev`. The Vite server serves `/api/start` itself, so the local client talks to the deployed agent.

**Hosted:** a production build (`npm run build`) uses Daily by default. Deploy `client/` to Vercel, which runs `api/start.ts` as a function, and set the two variables in the project's environment.

See `client/.env.example` for the other options.

## Building with an AI coding agent

`AGENTS.md` is a guide to building Pipecat apps for coding agents like Claude Code. For current Pipecat docs and API signatures instead of stale training data, set up the [Pipecat Context Hub](https://docs.pipecat.ai/api-reference/context-hub):

```bash
uv tool install "pipecat-ai[cli]"
pipecat context-hub install
```
