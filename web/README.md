# Frontend: Line QA voice agent

A Next.js app adapted from [livekit-examples/agent-starter-react](https://github.com/livekit-examples/agent-starter-react) (MIT, see LICENSE).

What changed from the starter:

- `components/app/welcome-view.tsx`: landing page for the demo (scenario, sample batches, pipeline).
- `components/app/demo-panel.tsx`: live incident record and per-turn latency table, fed by the
  agent over the LiveKit data channel (`qa.incident` and `qa.latency` topics).
- `components/app/view-controller.tsx`: renders the panel next to the voice session.
- `app/api/token/route.ts`: production-safe(ish) public token endpoint. It needs
  `ALLOW_PUBLIC_TOKENS=true`, issues 10-minute tokens, and sets agent dispatch on the server.
- `app/page.tsx`: voice only (no camera or screen share), always dispatches `AGENT_NAME`.

Local development:

```bash
cp .env.example .env.local   # fill in the LiveKit values
pnpm install
pnpm dev                     # http://localhost:3000
```

See the repo-root README for deployment.
