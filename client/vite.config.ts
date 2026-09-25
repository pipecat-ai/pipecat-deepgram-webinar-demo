import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type Connect, type Plugin } from "vite"

import { startBot } from "./api/start"

/**
 * Serves POST /api/start from the Vite dev and preview servers — the same
 * `startBot` that Vercel deploys from api/start.ts — so a local client can
 * start Pipecat Cloud sessions without `vercel dev`.
 */
function startEndpoint(env: Record<string, string>): Plugin {
  const handle: Connect.NextHandleFunction = async (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405
      res.setHeader("Allow", "POST")
      res.end()
      return
    }
    const { status, body } = await startBot({
      startUrl: env.BOT_START_URL,
      publicKey: env.BOT_START_PUBLIC_KEY,
    })
    res.statusCode = status
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify(body))
  }

  return {
    name: "pipecat-cloud-start",
    configureServer: (server) =>
      void server.middlewares.use("/api/start", handle),
    configurePreviewServer: (server) =>
      void server.middlewares.use("/api/start", handle),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // All of .env, not just VITE_ variables: the start endpoint needs the
  // server-side key. Only VITE_ variables ever reach the bundle.
  const env = loadEnv(mode, import.meta.dirname, "")

  return {
    plugins: [react(), tailwindcss(), startEndpoint(env)],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    server: {
      proxy: {
        // The Pipecat dev runner (uv run bot.py) serves the WebRTC offer
        // endpoint on port 7860.
        "/api/offer": "http://localhost:7860",
      },
    },
  }
})
