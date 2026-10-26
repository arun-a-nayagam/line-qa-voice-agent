"""
Line QA voice agent — log a food-production quality incident by voice.

A factory-floor operator talks (browser or phone) to an agent that captures a
quality incident: batch number, defect, severity, quantity affected. The agent
looks the batch up, reads the record back for confirmation, then logs it.

While it runs, it streams two things to the frontend over the LiveKit data
channel:
  * topic "qa.incident"  - the incident record as it fills in
  * topic "qa.latency"   - per-turn latency breakdown (end-of-turn, LLM TTFT,
                           TTS TTFB) taken from the SDK's own metrics events

The company, batches and products are fictional demo data.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import time
from dataclasses import dataclass, field

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    MetricsCollectedEvent,
    RunContext,
    TurnHandlingOptions,
    cli,
    function_tool,
    inference,
    metrics,
)

load_dotenv(".env.local")

logger = logging.getLogger("line-qa-agent")
logger.setLevel(logging.INFO)

AGENT_NAME = os.getenv("AGENT_NAME", "line-qa-agent")

# Public demo guardrail: the free LiveKit plan has a small inference budget,
# so each session is capped. Override with SESSION_LIMIT_SECONDS.
SESSION_LIMIT_SECONDS = int(os.getenv("SESSION_LIMIT_SECONDS", "180"))

# --------------------------------------------------------------------------
# Fictional plant data (stands in for the supplier/quality system's API)
# --------------------------------------------------------------------------
BATCHES: dict[str, dict] = {
    "4412": {"product": "Oat & honey granola bar, 45 g", "line": "Line 3", "shift": "Early", "packed": 18400},
    "4415": {"product": "Dark chocolate flapjack, 60 g", "line": "Line 3", "shift": "Late", "packed": 12750},
    "5108": {"product": "Sourdough sandwich loaf, 800 g", "line": "Line 1", "shift": "Night", "packed": 6200},
    "5121": {"product": "Seeded brown roll, 4-pack", "line": "Line 1", "shift": "Early", "packed": 9100},
    "6230": {"product": "Chilled tomato & basil soup, 600 ml", "line": "Line 5", "shift": "Late", "packed": 4800},
}

DEFECT_TYPES = [
    "seal failure",
    "foreign body",
    "underweight",
    "label or allergen error",
    "temperature deviation",
    "packaging damage",
    "other",
]

SEVERITY_GUIDE = (
    "critical = food safety or allergen risk, product must be held; "
    "major = quality failure, product likely held for inspection; "
    "minor = cosmetic or within tolerance, record only"
)


@dataclass
class IncidentState:
    room: rtc.Room | None = None
    incident: dict = field(default_factory=dict)
    status: str = "draft"  # draft -> confirmed -> logged

    async def publish(self) -> None:
        if not self.room:
            return
        payload = {"status": self.status, **self.incident}
        try:
            await self.room.local_participant.publish_data(
                json.dumps(payload), reliable=True, topic="qa.incident"
            )
        except Exception:  # never let UI updates break the conversation
            logger.exception("failed to publish incident update")


INSTRUCTIONS = f"""
You are the quality-incident line at Northbrook Foods, a food manufacturer. You talk
to operators and line supervisors standing on a noisy factory floor, often wearing
gloves. They want to log a problem quickly and get back to work.

Your job: capture one quality incident accurately, then log it.

Collect these fields, in a natural order, one or two at a time:
1. Batch number (four digits). As soon as you hear it, call lookup_batch.
2. Defect type. Map what they say to one of: {", ".join(DEFECT_TYPES)}.
3. Severity: critical, major or minor. If unsure, suggest one using this guide: {SEVERITY_GUIDE}.
4. Roughly how many units are affected.
5. A one-line description in their words.
6. Their name or initials, for the record.

Call update_incident every time you learn a field, so the record on screen stays current.

Before logging, read the record back in ONE short sentence and ask "shall I log that?".
Only call log_incident after a clear yes. After logging, give the incident reference
digit by digit, say what happens next in one sentence, and ask if there's anything else.

For a critical incident, also tell them to hold the batch and inform the shift QA lead.

Voice style:
- Short sentences. One question at a time. No lists, no markdown, no emojis.
- Say numbers the way people say them: "batch forty-four twelve".
- If a batch number isn't found, say so and ask them to read it again from the label.
- Stay on topic. If asked about something unrelated, say this line is for quality
  incidents only, and offer to help log one.
- You are a demo built on LiveKit. If someone asks what you are, say so plainly.
"""


class LineQAAgent(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=INSTRUCTIONS)

    async def on_enter(self) -> None:
        self.session.generate_reply(
            instructions=(
                "Greet the caller in one short sentence as the Northbrook Foods quality line, "
                "and ask for the batch number from the label."
            )
        )

    @function_tool()
    async def lookup_batch(self, context: RunContext[IncidentState], batch_number: str) -> str:
        """Look up a production batch by its four-digit batch number.

        Args:
            batch_number: The batch number as digits, e.g. "4412".
        """
        digits = "".join(ch for ch in batch_number if ch.isdigit())
        batch = BATCHES.get(digits)
        if not batch:
            return f"No batch {digits or batch_number} found. Ask the caller to re-read the label."

        state = context.userdata
        state.incident.update(
            {
                "batch": digits,
                "product": batch["product"],
                "line": batch["line"],
                "shift": batch["shift"],
            }
        )
        await state.publish()
        return (
            f"Batch {digits}: {batch['product']}, packed on {batch['line']}, "
            f"{batch['shift']} shift, {batch['packed']} units packed."
        )

    @function_tool()
    async def update_incident(
        self,
        context: RunContext[IncidentState],
        defect_type: str | None = None,
        severity: str | None = None,
        units_affected: int | None = None,
        description: str | None = None,
        reported_by: str | None = None,
    ) -> str:
        """Update the draft incident record with any fields learned so far.

        Args:
            defect_type: One of the allowed defect types.
            severity: critical, major or minor.
            units_affected: Approximate number of units affected.
            description: Short description in the caller's words.
            reported_by: Caller's name or initials.
        """
        state = context.userdata
        updates = {
            "defect_type": defect_type,
            "severity": severity.lower() if severity else None,
            "units_affected": units_affected,
            "description": description,
            "reported_by": reported_by,
        }
        state.incident.update({k: v for k, v in updates.items() if v not in (None, "")})
        await state.publish()

        missing = [
            f
            for f in ("batch", "defect_type", "severity", "units_affected", "description", "reported_by")
            if f not in state.incident
        ]
        return "Updated. Still needed: " + (", ".join(missing) if missing else "nothing, read back and confirm")

    @function_tool()
    async def log_incident(self, context: RunContext[IncidentState]) -> str:
        """Log the incident. Only call after the caller has confirmed the read-back."""
        state = context.userdata
        required = ("batch", "defect_type", "severity", "units_affected", "description")
        missing = [f for f in required if f not in state.incident]
        if missing:
            return "Cannot log yet. Missing: " + ", ".join(missing)

        ref = f"QI-{random.randint(1000, 9999)}"
        state.incident["reference"] = ref
        state.incident["logged_at"] = time.strftime("%H:%M:%S")
        state.status = "logged"
        await state.publish()

        logger.info("incident logged", extra={"incident": state.incident})
        hold = state.incident.get("severity") == "critical"
        return (
            f"Logged as {ref}. "
            + ("Batch is on QA hold; shift QA lead notified. " if hold else "")
            + "QA will review within the shift."
        )


server = AgentServer()


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name}

    state = IncidentState(room=ctx.room)

    session = AgentSession[IncidentState](
        userdata=state,
        # Cascaded pipeline, all through LiveKit Inference (no third-party keys).
        stt=inference.STT(model="deepgram/nova-3", language="en"),
        llm=inference.LLM(model="openai/gpt-4.1-mini"),
        tts=inference.TTS(model="cartesia/sonic-3", voice="9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"),
        turn_handling=TurnHandlingOptions(
            # Audio end-of-turn model: hears intonation, so a pause while someone
            # reads "forty-four ... twelve" off a label isn't taken as the end of turn.
            turn_detection=inference.TurnDetector(),
        ),
        # Start the LLM on the partial transcript before end-of-turn is final.
        preemptive_generation=True,
    )

    # ---- latency telemetry -------------------------------------------------
    # Group the SDK's per-stage metrics by speech_id, and publish one row per
    # agent reply once end-of-turn, LLM and TTS numbers have all arrived.
    turns: dict[str, dict] = {}

    async def publish_latency(speech_id: str, row: dict) -> None:
        total = row["eou_ms"] + row["llm_ttft_ms"] + row["tts_ttfb_ms"]
        payload = {"speech_id": speech_id, **row, "total_ms": round(total)}
        try:
            await ctx.room.local_participant.publish_data(
                json.dumps(payload), reliable=True, topic="qa.latency"
            )
        except Exception:
            logger.exception("failed to publish latency row")

    @session.on("metrics_collected")
    def _on_metrics(ev: MetricsCollectedEvent) -> None:
        m = ev.metrics
        metrics.log_metrics(m)

        speech_id = getattr(m, "speech_id", None)
        if not speech_id:
            return
        row = turns.setdefault(speech_id, {})
        if isinstance(m, metrics.EOUMetrics):
            row["eou_ms"] = round(m.end_of_utterance_delay * 1000)
            row["stt_ms"] = round(m.transcription_delay * 1000)
        elif isinstance(m, metrics.LLMMetrics) and not m.cancelled and "llm_ttft_ms" not in row:
            row["llm_ttft_ms"] = round(m.ttft * 1000)
        elif isinstance(m, metrics.TTSMetrics) and not m.cancelled and "tts_ttfb_ms" not in row:
            row["tts_ttfb_ms"] = round(m.ttfb * 1000)

        if {"eou_ms", "llm_ttft_ms", "tts_ttfb_ms"} <= row.keys() and not row.get("sent"):
            row["sent"] = True
            asyncio.create_task(publish_latency(speech_id, {k: v for k, v in row.items() if k != "sent"}))

    async def log_usage() -> None:
        logger.info("session usage: %s", session.usage)

    ctx.add_shutdown_callback(log_usage)

    # ---- session cap for the public demo ----------------------------------
    async def enforce_limit() -> None:
        await asyncio.sleep(SESSION_LIMIT_SECONDS)
        logger.info("session limit reached, closing")
        handle = session.say(
            "That's the end of the demo session. Thanks for trying it. Goodbye.",
            allow_interruptions=False,
        )
        await handle.wait_for_playout()
        ctx.shutdown(reason="demo session limit")

    await session.start(agent=LineQAAgent(), room=ctx.room)
    await ctx.connect()
    limiter = asyncio.create_task(enforce_limit())

    # Approximate caller location, set by the web token endpoint (country/region/city only).
    async def log_caller() -> None:
        try:
            p = await asyncio.wait_for(ctx.wait_for_participant(), timeout=30)
            a = p.attributes or {}
            logger.info(
                "call started from %s",
                ", ".join(v for v in (a.get("city"), a.get("region"), a.get("country")) if v)
                or "unknown location",
                extra={"caller_identity": p.identity, "caller_location": dict(a)},
            )
        except asyncio.TimeoutError:
            logger.info("no caller joined within 30s")

    asyncio.create_task(log_caller())
    ctx.add_shutdown_callback(lambda: _cancel(limiter))


async def _cancel(task: asyncio.Task) -> None:
    task.cancel()


if __name__ == "__main__":
    cli.run_app(server)
