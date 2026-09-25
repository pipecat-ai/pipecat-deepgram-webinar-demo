import { MicIcon, Volume2Icon } from "lucide-react"
import type { ReactNode } from "react"

import { Panel } from "@/components/panel"
import { ConnectButton } from "@/components/pipecat/connect-button"
import { DeviceSelect } from "@/components/pipecat/device-select"

/**
 * The screen before a session: pick a microphone and speaker, then connect.
 * The button follows the transport through connecting (click again to
 * cancel) and offers a retry if the attempt fails.
 */
export function ConnectScreen({
  onConnect,
  onDisconnect,
  error,
}: {
  onConnect: () => Promise<void>
  onDisconnect: () => Promise<void>
  error: string | null
}) {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto py-8">
      <div className="my-auto w-full max-w-sm space-y-7 px-2">
        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-medium tracking-tight">
            talk to the agent.
          </h2>
          <p className="text-muted-foreground">
            Pick your microphone and speakers, then connect.
          </p>
        </div>

        <Panel title="connect" footnote="deepgram flux · reservations">
          <div className="space-y-4 px-5 pt-6 pb-5">
            <DeviceField label="microphone">
              <DeviceSelect
                kind="audioinput"
                guide={<MicIcon aria-hidden="true" />}
                className="w-full"
              />
            </DeviceField>
            <DeviceField label="speakers">
              <DeviceSelect
                kind="audiooutput"
                guide={<Volume2Icon aria-hidden="true" />}
                className="w-full"
              />
            </DeviceField>
            <ConnectButton
              onConnect={() => void onConnect()}
              onDisconnect={() => void onDisconnect()}
              className="mt-2 h-11 w-full tracking-wider uppercase"
            />
          </div>
        </Panel>

        <div
          className="min-h-12 text-center"
          aria-live="polite"
          aria-atomic="true"
        >
          {error ? (
            <p role="alert" className="break-words text-inactive">
              {error}
            </p>
          ) : (
            <p className="text-muted-foreground">
              reservation line · ready when you are
            </p>
          )}
        </div>
      </div>
    </main>
  )
}

function DeviceField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}
