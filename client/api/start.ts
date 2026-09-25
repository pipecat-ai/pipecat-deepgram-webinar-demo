import type { VercelRequest, VercelResponse } from "@vercel/node"

/**
 * Starts a Pipecat Cloud agent session and hands the browser what it needs to
 * join it.
 *
 * The client can't call Pipecat Cloud itself: starting a session takes the
 * organization's public API key, and anything shipped to the browser is
 * readable by anyone. So the key lives here, on the server, and the browser
 * only ever sees the room it may join.
 *
 * The same `startBot` serves two hosts: Vercel deploys this file as the
 * `/api/start` function, and the Vite dev and preview servers mount it at the
 * same path (see vite.config.ts), so `npm run dev` can start cloud sessions too.
 *
 * Note this endpoint is unauthenticated. Anyone who finds it can start a
 * session on your account, so gate it before putting it in front of real
 * traffic — a bot check, a signed session, or rate limiting.
 */

export interface StartConfig {
  /**
   * The agent's full start endpoint,
   * https://api.pipecat.daily.co/v1/public/<agent-name>/start.
   */
  startUrl?: string
  /** Pipecat Cloud public API key (`pk_...`). */
  publicKey?: string
}

export interface StartResult {
  status: number
  body: Record<string, unknown>
}

interface StartResponse {
  dailyRoom?: string
  dailyToken?: string
}

/**
 * Starts a session on the agent and returns what to send the browser.
 *
 * The response shape is dictated by the caller: the Pipecat client posts here
 * via startBot() and passes the JSON straight to connect(), so a success must
 * be Daily call options — `{ url, token }`.
 */
export async function startBot({
  startUrl,
  publicKey,
}: StartConfig): Promise<StartResult> {
  if (!startUrl || !publicKey) {
    console.error(
      "Missing BOT_START_URL or BOT_START_PUBLIC_KEY — set both in the " +
        "server environment (client/.env locally)."
    )
    return {
      status: 500,
      body: { error: "The server is not configured to start a bot" },
    }
  }

  let started: Response
  try {
    started = await fetch(startUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${publicKey}`,
        "Content-Type": "application/json",
      },
      // Pipecat Cloud creates the Daily room and passes it to the agent, so
      // bot.py picks it up through its "daily" transport params.
      body: JSON.stringify({ createDailyRoom: true }),
    })
  } catch (err) {
    console.error("Could not reach Pipecat Cloud:", err)
    return { status: 502, body: { error: "Could not reach Pipecat Cloud" } }
  }

  if (!started.ok) {
    // Logged, not returned: the body names the agent and can explain which
    // credential was rejected.
    console.error(
      `Pipecat Cloud rejected the start request (${started.status}): ${await started.text()}`
    )
    return { status: 502, body: { error: "Failed to start the bot" } }
  }

  const { dailyRoom, dailyToken } = (await started.json()) as StartResponse
  if (!dailyRoom) {
    console.error("Pipecat Cloud started a session without a Daily room")
    return { status: 502, body: { error: "Failed to start the bot" } }
  }

  return { status: 200, body: { url: dailyRoom, token: dailyToken } }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST")
    res.status(405).json({ error: "Method not allowed" })
    return
  }

  const { status, body } = await startBot({
    startUrl: process.env.BOT_START_URL,
    publicKey: process.env.BOT_START_PUBLIC_KEY,
  })
  res.status(status).json(body)
}
