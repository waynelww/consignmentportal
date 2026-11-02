'use client'

/**
 * Full-screen barcode scanner using the phone's rear camera.
 *
 * Works on iPhone Safari and Android Chrome: it uses ZXing (pure JavaScript,
 * getUserMedia), not the native BarcodeDetector, which Safari does not have.
 *
 * Modes:
 * - "continuous": the camera stays open. Each new scan calls onDetect and
 *   shows the returned feedback (product name and photo) for a few seconds.
 *   Holding one pair in view counts once. The same pair counts again only
 *   after it has left the view for REPEAT_GAP_MS.
 * - "single": the first successful read calls onDetect, stops the camera and
 *   calls onClose.
 *
 * Feedback sounds use the Web Audio API. It is started from the open button
 * tap (primeAudio) because iOS only plays audio after a user gesture.
 */

import { useEffect, useRef, useState } from 'react'
import { X, Keyboard, CameraOff, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { normalizeBarcode } from '@/lib/barcode/normalize'
import { cn } from '@/lib/utils'

export interface ScanFeedback {
  tone: 'ok' | 'warn' | 'error'
  title: string
  detail?: string
  imageUrl?: string | null
}

export interface BarcodeScannerProps {
  open: boolean
  mode: 'continuous' | 'single'
  title: string
  hint?: string
  onClose: () => void
  onDetect: (code: string) => ScanFeedback | void | Promise<ScanFeedback | void>
}

/** Same pair in view again after this long away counts as a new scan. */
const REPEAT_GAP_MS = 1500
/** How long the product card stays on screen. */
const FEEDBACK_MS = 2500

// Pure JS decoders. Only the three formats the stock uses.
const FORMATS = ['EAN_13', 'UPC_A', 'CODE_128'] as const

let sharedAudio: AudioContext | null = null

export function primeScannerAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    if (!sharedAudio) sharedAudio = new AC()
    if (sharedAudio.state === 'suspended') void sharedAudio.resume()
  } catch {
    // Audio is optional. A silent scanner still works.
  }
}

function playTone(kind: ScanFeedback['tone']) {
  try {
    if (!sharedAudio || sharedAudio.state !== 'running') return
    const osc = sharedAudio.createOscillator()
    const gain = sharedAudio.createGain()
    osc.type = 'square'
    osc.frequency.value = kind === 'ok' ? 1800 : 300
    gain.gain.value = 0.2
    osc.connect(gain)
    gain.connect(sharedAudio.destination)
    const now = sharedAudio.currentTime
    osc.start(now)
    osc.stop(now + (kind === 'ok' ? 0.12 : 0.35))
  } catch {
    // ignore
  }
}

function buzz(kind: ScanFeedback['tone']) {
  try {
    navigator.vibrate?.(kind === 'ok' ? 60 : [120, 60, 120])
  } catch {
    // Not supported (iPhone Safari). Sound and screen still show the result.
  }
}

type ReaderControls = { stop: () => void }

export default function BarcodeScanner({
  open,
  mode,
  title,
  hint,
  onClose,
  onDetect,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<ReaderControls | null>(null)
  const activeRef = useRef(false)
  const lastSeenRef = useRef<Map<string, number>>(new Map())
  const onDetectRef = useRef(onDetect)
  const onCloseRef = useRef(onClose)
  const modeRef = useRef(mode)
  onDetectRef.current = onDetect
  onCloseRef.current = onClose
  modeRef.current = mode

  const [cameraError, setCameraError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null)
  const [scanCount, setScanCount] = useState(0)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showFeedback(fb: ScanFeedback) {
    setFeedback(fb)
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), FEEDBACK_MS)
  }

  async function handleCode(raw: string) {
    const key = normalizeBarcode(raw)
    if (!key) return
    const now = Date.now()
    const last = lastSeenRef.current.get(key)
    lastSeenRef.current.set(key, now)
    // Still the same pair in view: not a new scan
    if (last !== undefined && now - last < REPEAT_GAP_MS) return

    if (modeRef.current === 'single') {
      stopCamera()
      onCloseRef.current()
      await onDetectRef.current(raw)
      return
    }

    const result = await onDetectRef.current(raw)
    if (!result) return
    setScanCount((n) => n + 1)
    showFeedback(result)
    if (result.tone === 'ok') {
      playTone('ok')
      buzz('ok')
    } else {
      playTone(result.tone)
      buzz(result.tone)
    }
  }

  function stopCamera() {
    activeRef.current = false
    try {
      controlsRef.current?.stop()
    } catch {
      // already stopped
    }
    controlsRef.current = null
    const video = videoRef.current
    const stream = video?.srcObject as MediaStream | null | undefined
    stream?.getTracks().forEach((t) => t.stop())
    if (video) video.srcObject = null
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setCameraError(null)
    setReady(false)
    setFeedback(null)
    setScanCount(0)
    setManualOpen(false)
    lastSeenRef.current = new Map()
    activeRef.current = true

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('This browser cannot open the camera. Type the code instead.')
        return
      }
      try {
        // Loaded here, not at page load, so the scanner adds nothing to other screens
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ])
        if (cancelled || !videoRef.current) return

        const hints = new Map()
        hints.set(
          DecodeHintType.POSSIBLE_FORMATS,
          FORMATS.map((f) => BarcodeFormat[f]),
        )
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 80 })

        const controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoRef.current,
          (result) => {
            if (!activeRef.current || !result) return
            void handleCode(result.getText())
          },
        )

        if (cancelled) {
          controls.stop()
          return
        }
        controlsRef.current = controls
        setReady(true)
      } catch (err) {
        if (cancelled) return
        const name = err instanceof Error ? err.name : ''
        setCameraError(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'Camera access is blocked. Allow the camera for this site in your browser settings, or type the code instead.'
            : 'Could not start the camera. Type the code instead.',
        )
      }
    }

    void start()

    return () => {
      cancelled = true
      stopCamera()
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    }
    // The camera is started once per open. Handlers are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  function submitManual(e: React.FormEvent) {
    e.preventDefault()
    const code = manualCode.trim()
    if (!code) return
    setManualCode('')
    setManualOpen(false)
    void handleCode(code)
  }

  return (
    <div className="fixed inset-0 z-[90] bg-black flex flex-col">
      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-4 py-3 text-white bg-black/80">
        <div className="min-w-0">
          <p className="font-bold text-sm truncate">{title}</p>
          <p className="text-[11px] text-white/70 truncate">
            {hint ?? (mode === 'continuous' ? 'Scan a pair. Scan again to add another.' : 'Point the camera at the barcode.')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onClose()}
          className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center shrink-0"
          aria-label="Close scanner"
        >
          <X size={18} />
        </button>
      </div>

      {/* Camera */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
          autoPlay
        />

        {/* Aiming guide */}
        {ready && !cameraError && (
          <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-28 rounded-xl border-2 border-[#FFD700] shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] pointer-events-none" />
        )}

        {!ready && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm">
            Starting camera…
          </div>
        )}

        {cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-white">
            <CameraOff size={36} className="text-[#FFD700]" />
            <p className="text-sm">{cameraError}</p>
          </div>
        )}

        {/* Feedback card: product name and photo, shown briefly */}
        {feedback && (
          <div className="absolute left-3 right-3 bottom-4 z-10 pointer-events-none">
            <div
              className={cn(
                'flex items-center gap-3 rounded-2xl p-3 shadow-2xl',
                feedback.tone === 'ok' && 'bg-white',
                feedback.tone === 'warn' && 'bg-amber-50',
                feedback.tone === 'error' && 'bg-red-50',
              )}
            >
              <div className="w-16 h-16 rounded-xl bg-gray-100 overflow-hidden shrink-0 flex items-center justify-center">
                {feedback.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={feedback.imageUrl} alt="" className="w-full h-full object-cover" />
                ) : feedback.tone === 'ok' ? (
                  <CheckCircle2 size={28} className="text-green-600" />
                ) : feedback.tone === 'warn' ? (
                  <AlertTriangle size={28} className="text-amber-600" />
                ) : (
                  <XCircle size={28} className="text-red-600" />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-sm text-[#0A0A0A] leading-tight">{feedback.title}</p>
                {feedback.detail && (
                  <p className="text-xs text-gray-600 mt-0.5 leading-snug">{feedback.detail}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="relative z-10 bg-black/85 px-4 py-3 text-white space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-white/70">
            {mode === 'continuous' && scanCount > 0
              ? `${scanCount} scan${scanCount !== 1 ? 's' : ''} this session`
              : ' '}
          </p>
          <button
            type="button"
            onClick={() => setManualOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#FFD700]"
          >
            <Keyboard size={14} />
            Type code instead
          </button>
        </div>
        {manualOpen && (
          <form onSubmit={submitManual} className="flex gap-2">
            <input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              inputMode="numeric"
              autoFocus
              placeholder="Barcode number"
              className="flex-1 h-11 rounded-xl px-3 text-sm text-[#0A0A0A]"
            />
            <button type="submit" className="h-11 px-4 rounded-xl bg-[#FFD700] text-[#0A0A0A] font-bold text-sm">
              Use
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
