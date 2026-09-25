import type {
  APIRequest,
  TransportConnectionParams,
} from "@pipecat-ai/client-js"

import type { TransportFactory, TransportType } from "@/lib/transports"

/**
 * The offer endpoint of a locally running bot. The Vite dev server proxies
 * it to `uv run bot.py` on port 7860 (see vite.config.ts).
 */
const OFFER_URL = import.meta.env.VITE_OFFER_URL ?? "/api/offer"

/**
 * The start endpoint that launches a Pipecat Cloud session. Served by
 * `api/start.ts` (on Vercel, or by the Vite server locally), which holds the
 * Pipecat Cloud API key.
 */
const START_URL = import.meta.env.VITE_START_URL ?? "/api/start"

/** The transports this app knows how to reach a bot with. */
const SUPPORTED = ["smallwebrtc", "daily"] as const

type SupportedTransport = (typeof SUPPORTED)[number] & TransportType

/**
 * Builds each transport on demand. The imports stay dynamic so each transport
 * lands in its own chunk and only the one this build connects with is fetched.
 */
const FACTORIES: Record<SupportedTransport, TransportFactory> = {
  smallwebrtc: async (options) => {
    const { SmallWebRTCTransport } =
      await import("@pipecat-ai/small-webrtc-transport")
    return new SmallWebRTCTransport(options)
  },
  daily: async (options) => {
    const { DailyTransport } = await import("@pipecat-ai/daily-transport")
    return new DailyTransport(options)
  },
}

export interface SessionConfig {
  transportType: SupportedTransport
  transportFactory: TransportFactory
  /**
   * Either connection params the transport connects with directly, or an
   * `APIRequest` (an object with an `endpoint`), which makes the client
   * start a bot at that endpoint and connect with what it returns.
   */
  connectParams: TransportConnectionParams | APIRequest
}

/**
 * Picks the transport for this build: `smallwebrtc` in dev, `daily` in a
 * production build, unless VITE_TRANSPORT names one explicitly.
 */
function resolveTransport(): SupportedTransport {
  const requested = import.meta.env.VITE_TRANSPORT?.trim().toLowerCase()
  if (requested) {
    const match = SUPPORTED.find((name) => name === requested)
    if (match) return match
    console.warn(
      `Ignoring VITE_TRANSPORT="${requested}" — expected one of ` +
        `${SUPPORTED.join(", ")}. Falling back to the default for this build.`
    )
  }
  return import.meta.env.PROD ? "daily" : "smallwebrtc"
}

/**
 * How this build reaches a bot, and how it starts one.
 *
 * - **Local (`smallwebrtc`)** — the bot runs on your machine and serves its
 *   own offer endpoint, so the browser negotiates straight with it. There is
 *   no start endpoint and no key to protect.
 * - **Production (`daily`)** — the bot is a Pipecat Cloud agent, which hands
 *   out Daily rooms and needs a `pk_...` key to start a session. The key can
 *   never reach the browser, so the client posts to START_URL instead; that
 *   function starts the agent and returns the room URL and token to join.
 */
export function sessionConfig(): SessionConfig {
  const transportType = resolveTransport()
  const transportFactory = FACTORIES[transportType]

  if (transportType === "daily") {
    // An `endpoint` here routes through startBot(): the client POSTs to it and
    // passes the response to connect(), so the function must answer with Daily
    // call options ({ url, token }).
    return {
      transportType,
      transportFactory,
      connectParams: { endpoint: START_URL },
    }
  }

  return {
    transportType,
    transportFactory,
    connectParams: { webrtcUrl: OFFER_URL },
  }
}
