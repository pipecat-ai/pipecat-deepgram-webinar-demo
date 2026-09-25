import { RTVIEvent, type TransportState } from "@pipecat-ai/client-js"
import {
  usePipecatClient,
  usePipecatClientTransportState,
  useRTVIClientEvent,
} from "@pipecat-ai/client-react"
import { PhoneIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { DTMFKeypadView } from "@/components/pipecat/dtmf-keypad"
import { Panel } from "@/components/panel"
import { playRingback } from "@/lib/ringback"
import { cn } from "@/lib/utils"

const CONNECTABLE: TransportState[] = ["initialized", "disconnected", "error"]

export function DialScreen({
  onConnect,
  onDisconnect,
  error,
}: {
  onConnect: () => Promise<void>
  onDisconnect: () => Promise<void>
  error: string | null
}) {
  const client = usePipecatClient()
  const transportState = usePipecatClientTransportState() as TransportState
  const [digits, setDigits] = useState("")
  const [dialedNumber, setDialedNumber] = useState("")
  const [dialing, setDialing] = useState(false)
  const [dialError, setDialError] = useState<string | null>(null)
  const pending = useRef<{ sequence: string } | null>(null)
  const stopRing = useRef<(() => void) | null>(null)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopRinging = useCallback(() => {
    stopRing.current?.()
    stopRing.current = null
    if (timeout.current !== null) clearTimeout(timeout.current)
    timeout.current = null
  }, [])

  const cancelDial = useCallback(
    (reason: string | null = null) => {
      if (!pending.current) return
      const { sequence } = pending.current
      pending.current = null
      stopRinging()
      setDialing(false)
      setDigits(sequence)
      setDialError(reason)
      void onDisconnect().catch(() => {
        setDialError("Could not close the call. Refresh to try again.")
      })
    },
    [onDisconnect, stopRinging]
  )

  // The dial screen unmounts as soon as the transport is ready. Also stop on
  // early audio, errors, and remote disconnects, even if connect is pending.
  useEffect(() => stopRinging, [stopRinging])
  useRTVIClientEvent(RTVIEvent.BotReady, stopRinging)
  useRTVIClientEvent(RTVIEvent.BotStartedSpeaking, stopRinging)
  useRTVIClientEvent(
    RTVIEvent.Error,
    useCallback(() => {
      cancelDial("The call could not connect. Please try again.")
    }, [cancelDial])
  )
  useRTVIClientEvent(
    RTVIEvent.Disconnected,
    useCallback(() => {
      cancelDial("The call ended before connecting. Please try again.")
    }, [cancelDial])
  )

  const handleSend = async (sequence: string) => {
    if (pending.current || !client || !CONNECTABLE.includes(client.state))
      return
    const attempt = { sequence }
    pending.current = attempt
    setDialedNumber(sequence)
    setDialing(true)
    setDialError(null)
    stopRing.current = playRingback()
    timeout.current = setTimeout(() => {
      cancelDial("No answer. Please try again.")
    }, 45_000)
    try {
      // The digits give this demo its dial-in feel; they do not route a PSTN
      // call or send DTMF into the reservation conversation.
      await onConnect()
    } catch (cause) {
      if (pending.current === attempt) {
        setDialError(
          cause instanceof Error
            ? cause.message
            : "Unable to connect. Try again."
        )
      }
    } finally {
      if (pending.current === attempt) {
        stopRinging()
        pending.current = null
        setDialing(false)
        setDigits(sequence)
      }
    }
  }

  const message = dialError ?? error
  const busy = dialing || !CONNECTABLE.includes(transportState)

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto py-8">
      <div className="my-auto w-full max-w-sm space-y-7 px-2">
        <div className="space-y-2 text-center">
          <PhoneIcon
            className="mx-auto mb-4 size-5 text-agent"
            aria-hidden="true"
          />
          <h2 className="text-2xl font-medium tracking-tight">
            give us a ring.
          </h2>
          <p className="text-muted-foreground">
            Enter a few digits, then send to call.
          </p>
        </div>

        <Panel title="dial in" footnote="deepgram flux · reservations">
          <div className="px-5 pt-6 pb-5">
            <DTMFKeypadView
              mode="buffered"
              variant="outline"
              value={dialing ? dialedNumber : digits}
              onValueChange={setDigits}
              onSend={handleSend}
              disabled={busy}
              sendLabel={dialing ? "Calling…" : "Send"}
              className="gap-3 [&_[data-slot=input]]:h-12 [&_[data-slot=input]]:text-lg [&_button[aria-label^=DTMF]]:min-h-14 [&>button]:h-11 [&>button]:border-active/60 [&>button]:text-active [&>button]:hover:bg-active/10"
            />
          </div>
        </Panel>

        <div
          className="min-h-12 text-center"
          aria-live="polite"
          aria-atomic="true"
        >
          <p className={cn("text-muted-foreground", dialing && "text-tool")}>
            {dialing
              ? `ringing · ${dialedNumber}`
              : "reservation line · ready when you are"}
          </p>
          {dialing && (
            <button
              type="button"
              onClick={() => cancelDial()}
              className="mt-2 px-3 py-1 text-inactive underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-inactive"
            >
              Cancel call
            </button>
          )}
          {!dialing && message && (
            <p role="alert" className="mt-2 break-words text-inactive">
              {message}
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
