import { App } from '@/components/app/app';

// Tokens come from the included endpoint (app/api/token/route.ts), which signs them with
// LIVEKIT_API_KEY / LIVEKIT_API_SECRET and dispatches the agent named in AGENT_NAME.
// LIVEKIT_TOKEN_SERVER_ID (LiveKit Cloud development token server) also works for local testing.
const tokenServerId = process.env.LIVEKIT_TOKEN_SERVER_ID;

export default function Page() {
  return (
    <App
      tokenServerId={tokenServerId}
      tokenEndpoint="/api/token"
      agentName={process.env.AGENT_NAME || 'line-qa-agent'}
      // Voice-only agent: no camera or screen share.
      isVideoInputSupported={false}
    />
  );
}
