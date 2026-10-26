import { NextResponse } from 'next/server';
import {
  AccessToken,
  type AccessTokenOptions,
  RoomAgentDispatch,
  RoomConfiguration,
  type VideoGrant,
} from 'livekit-server-sdk';

type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
};

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;
const AGENT_NAME = process.env.AGENT_NAME || 'line-qa-agent';

// This endpoint hands a short-lived room token to anyone who asks. That is fine for a
// public demo on the free LiveKit Build plan (usage is hard-capped, there is no bill to run
// up), but it must be switched on deliberately: set ALLOW_PUBLIC_TOKENS=true.
// Abuse limits: 10-minute tokens, a fresh random room per request, and the agent itself
// ends every session after SESSION_LIMIT_SECONDS.
const ALLOW_PUBLIC_TOKENS = process.env.ALLOW_PUBLIC_TOKENS === 'true';

export const revalidate = 0;

export async function POST() {
  if (process.env.NODE_ENV !== 'development' && !ALLOW_PUBLIC_TOKENS) {
    return new NextResponse(
      'Token endpoint disabled. Set ALLOW_PUBLIC_TOKENS=true to serve a public demo.',
      { status: 403 }
    );
  }

  try {
    if (!LIVEKIT_URL) throw new Error('LIVEKIT_URL is not defined');
    if (!API_KEY) throw new Error('LIVEKIT_API_KEY is not defined');
    if (!API_SECRET) throw new Error('LIVEKIT_API_SECRET is not defined');

    // Dispatch is decided here, not by the browser: every room gets exactly this agent,
    // whatever room_config the client sends.
    const roomConfig = new RoomConfiguration({
      agents: [new RoomAgentDispatch({ agentName: AGENT_NAME })],
    });

    const suffix = crypto.randomUUID().slice(0, 8);
    const participantIdentity = `operator_${suffix}`;
    const roomName = `qa_line_${suffix}`;

    const participantToken = await createParticipantToken(
      { identity: participantIdentity, name: 'Operator' },
      roomName,
      roomConfig
    );

    const data: ConnectionDetails = {
      serverUrl: LIVEKIT_URL,
      roomName,
      participantName: 'Operator',
      participantToken,
    };
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error(error);
    return new NextResponse(error instanceof Error ? error.message : 'Token error', {
      status: 500,
    });
  }
}

function createParticipantToken(
  userInfo: AccessTokenOptions,
  roomName: string,
  roomConfig: RoomConfiguration
): Promise<string> {
  const at = new AccessToken(API_KEY, API_SECRET, { ...userInfo, ttl: '10m' });
  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  at.addGrant(grant);
  at.roomConfig = roomConfig;
  return at.toJwt();
}
