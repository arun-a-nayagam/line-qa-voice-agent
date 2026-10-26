# Line QA voice agent

A voice agent that lets a food-production operator log a quality incident by talking.
It looks up the batch, captures defect, severity and quantity, reads the record back,
logs it, and shows the record and a per-turn latency breakdown live in the browser.

Built on LiveKit Agents (Python) and deployed on LiveKit Cloud, with a Next.js frontend
on Vercel. Both run on free tiers. The company ("Northbrook Foods"), products and
batches are fictional.

```
browser (Next.js on Vercel)
   │  WebRTC audio + data channel
   ▼
LiveKit Cloud room ──► agent (Python, LiveKit Cloud)
                          STT  deepgram/nova-3        ┐
                          turn LiveKit audio detector │ all via LiveKit Inference
                          LLM  openai/gpt-4.1-mini    │ (no third-party API keys)
                          TTS  cartesia/sonic-3       ┘
                          tools: lookup_batch, update_incident, log_incident
```

```
agent/   Python agent  (agent.py, Dockerfile, pyproject.toml, uv.lock)
web/     Next.js frontend, adapted from livekit-examples/agent-starter-react
```

---

## Deploy it (about 30–40 minutes, all free)

You need: a GitHub account, Python 3.10+, Node 20+ with pnpm, and
[uv](https://docs.astral.sh/uv/getting-started/installation/).

### 1. LiveKit Cloud project

1. Sign up at <https://cloud.livekit.io>. The **Build** plan is free and needs no card.
2. Create a project. Pick a region close to you (for example EU).

### 2. Install the LiveKit CLI and log in

```bash
# macOS
brew install livekit-cli
# Windows
winget install LiveKit.LiveKitCLI
# Linux
curl -sSL https://get.livekit.io/cli | bash

lk cloud auth          # opens the browser to link the CLI to your project
```

### 3. Run the agent locally first

```bash
cd agent
lk app env --write --destination .env.local   # writes LIVEKIT_URL / API key / secret
uv sync
uv run agent.py console                       # talk to it from your terminal
```

Say "I need to log a seal failure on batch 4412". You should hear it confirm the
product and walk you through the rest. Press Ctrl+C to stop.

### 4. Deploy the agent to LiveKit Cloud

```bash
cd agent
lk agent create        # registers the agent, builds the Dockerfile in the cloud, deploys
lk agent status        # should show it running
lk agent logs          # live logs, handy during the first test call
```

`lk agent create` writes a `livekit.toml`. Commit it.

### 5. Push the repo to GitHub

```bash
cd ..                  # repo root
git init && git add . && git commit -m "Line QA voice agent"
gh repo create line-qa-voice-agent --public --source . --push
```

(Or create the repo on github.com and push to it.) `.env.local` is git-ignored, so
check that it isn't committed.

### 6. Deploy the frontend to Vercel

1. Go to <https://vercel.com/new> and import the repo.
2. Set **Root Directory** to `web`. The framework is detected as Next.js.
3. Add these environment variables. The values are the same as `agent/.env.local`:

| Name | Value |
|---|---|
| `LIVEKIT_URL` | `wss://<your-project>.livekit.cloud` |
| `LIVEKIT_API_KEY` | from `.env.local` |
| `LIVEKIT_API_SECRET` | from `.env.local` |
| `AGENT_NAME` | `line-qa-agent` |
| `ALLOW_PUBLIC_TOKENS` | `true` |
| `NEXT_PUBLIC_AUTHOR_NAME` | your name |
| `NEXT_PUBLIC_REPO_URL` | your GitHub repo URL |

4. Deploy. You'll get a URL such as `https://line-qa-voice-agent.vercel.app`. To get a
   nicer subdomain, rename the project under Settings → General.

### 7. Test the link

Open it in Chrome, click **Start call**, allow the microphone, and log an incident end
to end. In the LiveKit Cloud dashboard, the **Agents** and **Sessions** pages show the
session, transcript and metrics.

The first call after a quiet spell can take a few seconds to connect, because the Build
plan has cold starts. Make a test call shortly before you send the link anywhere.

### Optional: a phone number

The Build plan includes one free US local number. In the dashboard, go to
**Telephony → Phone numbers → Buy number**, then create a dispatch rule that targets the
agent `line-qa-agent`. The same agent answers phone calls with no code changes. Callers
from the UK pay international rates, so present this as "it also works over SIP" rather
than the main link.

---

## Free-tier budget

On the Build plan the allowances are **hard caps**: nothing is billed, and requests
simply fail once a cap is reached.

| Resource | Build allowance | What it means here |
|---|---|---|
| Agent session minutes | 1,000 / month | plenty |
| LiveKit Inference credits | $2.50 / month (≈50 conversation minutes) | **the real limit** |
| Concurrent agent sessions | 5 | fine for reviewers |

Each session is capped at 3 minutes (`SESSION_LIMIT_SECONDS` in the agent), so the
credits cover roughly 15–25 full demo calls a month. Keep your own testing short, and
check usage in the dashboard before you share the link.

---

## How it works (the parts worth talking about)

**Turn detection.** `inference.TurnDetector()` is LiveKit's audio end-of-turn model. It
hears intonation as well as words, so an operator who pauses mid-number ("batch
forty-four… twelve") isn't cut off. With it, the endpointing delay drops from the
default 0.5–3.0 s to 0.3–2.5 s. When deployed to LiveKit Cloud it uses the full `v1`
model, and falls back to the local `v1-mini` if inference is unavailable.

**Preemptive generation.** `preemptive_generation=True` starts the LLM on the partial
transcript before end-of-turn is confirmed. That hides some LLM latency, at the cost of
occasionally throwing a generation away.

**Tools as the system of record.** The LLM never invents data. `lookup_batch` is the
only source of product and line details, `update_incident` keeps the on-screen record
in sync, and `log_incident` refuses to log while required fields are missing.

**Latency telemetry.** The agent listens to `metrics_collected` and groups
`EOUMetrics`, `LLMMetrics` and `TTSMetrics` by `speech_id`. Once all three have arrived
it publishes one row to the browser on the `qa.latency` data topic. The numbers are the
SDK's own measurements, not estimates.

**Cascaded instead of speech-to-speech.** A cascaded pipeline lets you swap or tune each
stage independently (a phone-call STT model, a different voice) and see exactly where the
time goes. A realtime speech-to-speech model can be faster end to end, but you give up
that visibility.

**Locking down the public token endpoint.** `web/app/api/token/route.ts` only serves
tokens in production when `ALLOW_PUBLIC_TOKENS=true`. Tokens expire after 10 minutes,
each request gets a fresh random room, and the agent to dispatch is set on the server,
so the browser can't request a different agent.

## Ideas for a next iteration

- Replace the fictional batch table with a call to a real quality-system API.
- Add `BVCTelephony` noise cancellation for phone callers on a noisy floor.
- Hand off to a second agent for critical incidents (hold the batch, page the QA lead).
- Add tests with the Agents SDK test helpers, for example "never logs without a confirmed read-back".
