#
# Copyright (c) 2026, Daily
#
# SPDX-License-Identifier: BSD 2-Clause License
#

"""deepgram-webinar-demo - Pipecat Voice Agent

A restaurant reservation agent on a cascade pipeline:

    Deepgram Flux (STT) → OpenAI GPT-5.6 Luna (LLM) → Deepgram Flux (TTS)

Run the bot using::

    uv run bot.py
"""

import os
from datetime import datetime

from dotenv import load_dotenv
from loguru import logger
from pipecat.evals.transport import EvalTransportParams
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.processors.frameworks.rtvi import (
    RTVIFunctionCallReportLevel,
    RTVIObserverParams,
)
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService
from pipecat.services.deepgram.flux.tts import DeepgramFluxTTSService
from pipecat.services.openai.responses.llm import (
    OpenAIResponsesLLMService,
    OpenAIResponsesReasoningConfig,
)
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.transports.daily.transport import DailyParams
from pipecat.workers.runner import WorkerRunner

from tools import TOOLS, ReservationStore

load_dotenv(override=True)


SYSTEM_INSTRUCTION = (
    "You are a restaurant reservation assistant on a phone call. "
    "Today is {today_spoken} ({today_iso}). "
    "Your job is to take reservations: use your tools to look up, create, and update reservations. "
    "Before creating a reservation you need the caller's name, party size, date, and time. "
    "Once the caller has said what they want, ask for everything still missing in one sentence. "
    "Ask only for what they haven't given you: never ask again for a detail they already stated, "
    "and if they gave you all four, book it straight away without asking them to confirm. "
    "Every time a caller asks for is available: you have no way to check availability, so never "
    "offer to check and never say you are checking. "
    'Don\'t narrate your own tool use — no "let me check" or "one moment". Either answer, or '
    "call the tool and then say what it did. "
    'Resolve relative dates like "tomorrow" or "next Friday" against today\'s date, and pass '
    "dates to your tools in YYYY-MM-DD format. "
    'Say dates the short way a person would on the phone: "tomorrow", "Saturday", or "the 29th". '
    "Never say the year, and never read a YYYY-MM-DD date aloud. "
    "After booking or changing a reservation, read the details back briefly with the "
    "confirmation number. "
    "When the caller says goodbye, or their reservation is settled and they need nothing else, "
    "say a short goodbye and then call end_call in that same turn. "
    "Keep responses brief. Your responses are spoken aloud, so use plain sentences: no emojis, "
    "lists, or formatting, and never reply with nothing."
)


def ordinal(day: int) -> str:
    """Return a day of the month with its English ordinal suffix, e.g. 1 -> "1st"."""
    suffix = "th" if day in (11, 12, 13) else {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return f"{day}{suffix}"


def build_system_instruction() -> str:
    """Stamp the system instruction with today's date.

    Called per session so a long-running server doesn't get stuck on the date
    it started up.
    """
    now = datetime.now()
    return SYSTEM_INSTRUCTION.format(
        # The spoken form models the phrasing we want back on the call; the ISO
        # form is what the tools take.
        today_spoken=f"{now:%A} the {ordinal(now.day)}",
        today_iso=f"{now:%Y-%m-%d}",
    )


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments) -> None:
    """Run the voice bot for this session."""
    logger.info("Starting bot")

    # Explicit processor names let the client tell each service's metrics apart.

    # Speech-to-Text: Flux transcribes and detects the end of each turn with one
    # model.
    stt = DeepgramFluxSTTService(name="stt", api_key=os.getenv("DEEPGRAM_API_KEY"))

    # LLM: GPT-5.6 Luna over the Responses API WebSocket, with reasoning off for
    # the lowest time to first token.
    llm = OpenAIResponsesLLMService(
        name="llm",
        api_key=os.getenv("OPENAI_API_KEY"),
        settings=OpenAIResponsesLLMService.Settings(
            model=os.getenv("OPENAI_MODEL", "gpt-5.6-luna"),
            system_instruction=build_system_instruction(),
            reasoning=OpenAIResponsesReasoningConfig(effort="none"),
        ),
    )

    # Text-to-Speech: Flux streams LLM tokens straight to synthesis.
    tts = DeepgramFluxTTSService(
        name="tts",
        api_key=os.getenv("DEEPGRAM_API_KEY"),
        settings=DeepgramFluxTTSService.Settings(
            voice=os.getenv("DEEPGRAM_VOICE", "flux-heather-en"),
        ),
    )

    context = LLMContext(tools=TOOLS)
    # No VAD or turn analyzer here: Flux proposes each turn boundary and requests
    # ExternalUserTurnStrategies on its own, so it alone decides when the user is
    # done and when they barge in.
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(context)

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        # Report tool call names to the client so the UI can count them; the
        # default level sends only the call ID.
        rtvi_observer_params=RTVIObserverParams(
            function_call_report_level={"*": RTVIFunctionCallReportLevel.NAME},
        ),
        # Shared with the tool handlers as params.app_resources
        app_resources=ReservationStore(),
    )

    runner = WorkerRunner(handle_sigint=runner_args.handle_sigint)

    await runner.add_workers(worker)

    @worker.rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi):
        # Kick off the conversation
        context.add_message(
            {
                "role": "developer",
                "content": "Concisely greet the caller and ask how you can help with their reservation.",
            }
        )
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info("Client connected")

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected")
        await runner.cancel()

    await runner.run()


async def bot(runner_args: RunnerArguments):
    """Main bot entry point."""
    # Krisp is available when deployed to Pipecat Cloud
    if os.environ.get("ENV") != "local":
        from pipecat.audio.filters.krisp_viva_filter import KrispVivaFilter

        krisp_filter = KrispVivaFilter()
    else:
        krisp_filter = None

    transport_params = {
        "daily": lambda: DailyParams(
            audio_in_enabled=True,
            audio_in_filter=krisp_filter,
            audio_out_enabled=True,
        ),
        "webrtc": lambda: TransportParams(
            audio_in_enabled=True,
            audio_in_filter=krisp_filter,
            audio_out_enabled=True,
        ),
        # Behavioral evals: run with `-t eval` to drive this bot via `pipecat eval`.
        "eval": lambda: EvalTransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
    }

    transport = await create_transport(runner_args, transport_params)

    await run_bot(transport, runner_args)


if __name__ == "__main__":
    from pipecat.runner.run import main

    main()
