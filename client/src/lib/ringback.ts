/** Local ringback: two seconds on, four seconds off. Never sent to the bot. */
export function playRingback(): () => void {
  if (typeof window === "undefined" || !window.AudioContext) return () => {}

  let context: AudioContext
  try {
    // Called directly from Send so browser autoplay policy allows the tone.
    context = new window.AudioContext()
  } catch {
    return () => {}
  }

  const gain = context.createGain()
  gain.gain.value = 0
  gain.connect(context.destination)

  const oscillators = [440, 480].map((frequency) => {
    const oscillator = context.createOscillator()
    oscillator.type = "sine"
    oscillator.frequency.value = frequency
    oscillator.connect(gain)
    oscillator.start()
    return oscillator
  })

  const ring = () => {
    const now = context.currentTime
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.06, now + 0.015)
    gain.gain.setValueAtTime(0.06, now + 1.985)
    gain.gain.linearRampToValueAtTime(0, now + 2)
  }

  ring()
  const timer = window.setInterval(ring, 6000)
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    window.clearInterval(timer)
    gain.gain.cancelScheduledValues(context.currentTime)
    gain.gain.setValueAtTime(0, context.currentTime)
    oscillators.forEach((oscillator) => {
      oscillator.stop()
      oscillator.disconnect()
    })
    gain.disconnect()
    void context.close().catch(() => {})
  }

  // Audio being unavailable must not prevent the call itself from connecting.
  void context.resume().catch(stop)
  return stop
}
