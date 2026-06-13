"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/* ============================================================================
 * GameController — a shared, configurable controller for the arcade games.
 *
 * It owns *all* the messy TV-remote plumbing that used to be duplicated in
 * each game:
 *   - window-level keydown/keyup (capture phase) so steering works even when
 *     nothing is focused, and so Radix Tabs can't hijack the arrow keys
 *   - numeric `keyCode` maps + legacy "Up"/"Down" names for older TV browsers
 *   - Tizen media-key registration (no-op off-TV)
 *   - ring-as-wheel and ring-as-virtual-pointer fallbacks on the focused button
 *   - the visual arrow pad + OK box + status-aware labels
 *   - an optional, toggleable debug strip for diagnosing a new remote
 *
 * Games stay in charge of their own loop; they just receive semantic events:
 *   onPress(dir)   — a direction was pressed (key / swipe / wheel / ring)
 *   onRelease(dir) — that direction was released (hold mode only)
 *   onOk()         — OK / Enter / Space / Play
 * ==========================================================================*/

export type Dir4 = "up" | "down" | "left" | "right"
export type ControllerStatus = "idle" | "playing" | "paused" | "over" | "cleared"

/* ----- Key resolution (shared across all games) ----- */

const KEY_TO_DIR: Record<string, Dir4> = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  // Legacy WebKit / some Tizen builds emit IE-style names:
  Up: "up", Down: "down", Left: "left", Right: "right",
  w: "up", s: "down", a: "left", d: "right",
  W: "up", S: "down", A: "left", D: "right",
}

// Samsung Smart TVs use the standard 37-40 D-pad codes, but some older web
// builds use the 295xx range — accept both.
const CODE_TO_DIR: Record<number, Dir4> = {
  38: "up", 40: "down", 37: "left", 39: "right",
  29460: "up", 29461: "down", 29462: "left", 29463: "right",
}

const OK_KEYS = new Set([" ", "Enter", "Spacebar"])
// OK/Enter (13), Play (415), Pause (19), Tizen MediaPlayPause (10252)
const OK_CODES = new Set([13, 415, 19, 10252])

function resolveKey(e: KeyboardEvent | React.KeyboardEvent): { dir?: Dir4; ok?: boolean } {
  const dir = KEY_TO_DIR[e.key] ?? CODE_TO_DIR[(e as KeyboardEvent).keyCode]
  if (dir) return { dir }
  if (OK_KEYS.has(e.key) || OK_CODES.has((e as KeyboardEvent).keyCode)) return { ok: true }
  return {}
}

/* ----- Props ----- */

export type GameControllerProps = {
  /** "both" = 4-way pad (snake); "vertical" = up/down only (krakout bat). */
  axes?: "both" | "vertical"
  /** "tap" = discrete presses flash briefly; "hold" = arrow stays lit until release. */
  mode?: "tap" | "hold"
  status: ControllerStatus
  onPress: (dir: Dir4) => void
  onRelease?: (dir: Dir4) => void
  onOk: () => void
  /** Status-aware button captions. Sensible defaults provided. */
  labels?: Partial<{
    start: string      // idle
    again: string      // over
    resume: string     // paused
    next: string       // cleared
    takeControl: string // playing, not focused
    active: string     // playing, focused
  }>
  /** Small caption under the pad. */
  hint?: Partial<{ active: string; takeControl: string; idle: string }>
  /** Width of the controller block. Defaults to "max-w-xs". */
  widthClass?: string
  /** Render the toggleable debug strip. */
  debug?: boolean
}

const DEFAULT_LABELS = {
  start: "Start Game",
  again: "Play Again",
  resume: "Resume",
  next: "Next Level",
  takeControl: "Click to take control",
  active: "Controller active",
}
const DEFAULT_HINT = {
  active: "TV remote · arrows · WASD",
  takeControl: "click here, then steer",
  idle: "press to begin",
}

export function GameController({
  axes = "both",
  mode = "tap",
  status,
  onPress,
  onRelease,
  onOk,
  labels,
  hint,
  widthClass = "max-w-xs",
  debug = false,
}: GameControllerProps) {
  const L = { ...DEFAULT_LABELS, ...labels }
  const Hn = { ...DEFAULT_HINT, ...hint }

  const buttonRef = useRef<HTMLButtonElement>(null)
  const [focused, setFocused] = useState(false)
  const playing = status === "playing"

  // Latest callbacks/config in refs so the window listener stays stable.
  const cbRef = useRef({ onPress, onRelease, onOk, axes, mode })
  useEffect(() => {
    cbRef.current = { onPress, onRelease, onOk, axes, mode }
  }, [onPress, onRelease, onOk, axes, mode])

  // Visual "pressed" arrows. In hold mode they stay lit until keyup; in tap
  // mode each press flashes for ~180ms.
  const [pressed, setPressed] = useState<Set<Dir4>>(new Set())
  const flashTimers = useRef<Map<Dir4, number>>(new Map())

  const acceptsDir = useCallback(
    (dir: Dir4) => cbRef.current.axes === "both" || dir === "up" || dir === "down",
    [],
  )

  const showPressed = useCallback((dir: Dir4) => {
    setPressed((prev) => {
      if (prev.has(dir)) return prev
      const next = new Set(prev)
      next.add(dir)
      return next
    })
  }, [])
  const clearPressed = useCallback((dir: Dir4) => {
    setPressed((prev) => {
      if (!prev.has(dir)) return prev
      const next = new Set(prev)
      next.delete(dir)
      return next
    })
  }, [])
  const flashPressed = useCallback((dir: Dir4) => {
    showPressed(dir)
    const existing = flashTimers.current.get(dir)
    if (existing) window.clearTimeout(existing)
    flashTimers.current.set(dir, window.setTimeout(() => clearPressed(dir), 180))
  }, [showPressed, clearPressed])

  /* ----- Debug strip (toggleable) ----- */
  const [debugOn, setDebugOn] = useState(false)
  const [events, setEvents] = useState<string[]>([])
  const log = useCallback((line: string) => {
    setEvents((prev) => [line, ...prev].slice(0, 6))
  }, [])

  /* ----- Press / release dispatch ----- */

  const press = useCallback((dir: Dir4) => {
    if (!acceptsDir(dir)) return
    cbRef.current.onPress(dir)
    if (cbRef.current.mode === "hold") showPressed(dir)
    else flashPressed(dir)
  }, [acceptsDir, showPressed, flashPressed])

  const release = useCallback((dir: Dir4) => {
    if (!acceptsDir(dir)) return
    cbRef.current.onRelease?.(dir)
    clearPressed(dir)
  }, [acceptsDir, clearPressed])

  // Analog (wheel / ring) → a brief nudge. In hold mode we auto-release so the
  // bat doesn't run away on a single swipe.
  const pulse = useCallback((dir: Dir4) => {
    if (!acceptsDir(dir)) return
    cbRef.current.onPress(dir)
    if (cbRef.current.mode === "hold") {
      showPressed(dir)
      window.setTimeout(() => {
        cbRef.current.onRelease?.(dir)
        clearPressed(dir)
      }, 220)
    } else {
      flashPressed(dir)
    }
  }, [acceptsDir, showPressed, clearPressed, flashPressed])

  /* ----- Global window capture: keydown + keyup ----- */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { dir, ok } = resolveKey(e)
      if (dir && acceptsDir(dir)) {
        // Capture-phase stopPropagation keeps Radix Tabs from switching tabs.
        e.preventDefault()
        e.stopPropagation()
        if (debug) log(`keydown key="${e.key}" code=${e.keyCode}`)
        press(dir)
        return
      }
      if (ok) {
        e.preventDefault()
        e.stopPropagation()
        // Ignore auto-repeat so a held OK doesn't fire twice (e.g. release +
        // immediate pause in krakout).
        if (e.repeat) return
        if (debug) log(`ok key="${e.key}" code=${e.keyCode}`)
        cbRef.current.onOk()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const { dir } = resolveKey(e)
      if (dir && acceptsDir(dir)) release(dir)
    }

    // Tizen exposes a key registration API; register the media keys we use so
    // the platform routes them to the page. No-op in normal browsers.
    const tizen = (window as unknown as { tizen?: any }).tizen
    try {
      tizen?.tvinputdevice?.registerKeyBatch?.([
        "MediaPlay", "MediaPause", "MediaPlayPause", "MediaStop",
      ])
    } catch {
      // not on a Tizen TV
    }

    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("keyup", onKeyUp, true)
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("keyup", onKeyUp, true)
    }
  }, [acceptsDir, press, release, debug, log])

  /* ----- Button caption / hint ----- */
  const caption =
    status === "playing" ? (focused ? L.active : L.takeControl)
    : status === "paused" ? L.resume
    : status === "over" ? L.again
    : status === "cleared" ? L.next
    : L.start
  const hintText =
    status === "playing" ? (focused ? Hn.active : Hn.takeControl) : Hn.idle

  // Ring-as-virtual-pointer accumulator.
  const accum = useRef({ x: 0, y: 0 })

  return (
    <div className={`flex w-full ${widthClass} flex-col items-center gap-2`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          onOk()
          buttonRef.current?.focus()
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          // Release any held arrows so the bat/snake doesn't keep moving.
          for (const d of ["up", "down", "left", "right"] as Dir4[]) release(d)
        }}
        // Ring-as-wheel firmware.
        onWheel={(e) => {
          const { deltaX, deltaY } = e
          if (Math.abs(deltaX) < 4 && Math.abs(deltaY) < 4) return
          if (debug) log(`wheel dx=${Math.round(deltaX)} dy=${Math.round(deltaY)}`)
          if (Math.abs(deltaX) > Math.abs(deltaY)) pulse(deltaX > 0 ? "right" : "left")
          else pulse(deltaY > 0 ? "down" : "up")
        }}
        // Ring-as-virtual-pointer firmware.
        onPointerMove={(e) => {
          accum.current.x += e.movementX || 0
          accum.current.y += e.movementY || 0
          const { x, y } = accum.current
          const TH = 28
          if (Math.abs(x) < TH && Math.abs(y) < TH) return
          if (debug) log(`pointer dx=${Math.round(x)} dy=${Math.round(y)}`)
          if (Math.abs(x) > Math.abs(y)) pulse(x > 0 ? "right" : "left")
          else pulse(y > 0 ? "down" : "up")
          accum.current = { x: 0, y: 0 }
        }}
        onPointerLeave={() => { accum.current = { x: 0, y: 0 } }}
        aria-label="Game controller — click to start, then use the remote ring or arrow keys to steer"
        className={`flex w-full flex-col items-center gap-3 rounded-2xl border-2 p-5 outline-none transition-colors ${
          playing && focused
            ? "border-primary bg-primary/15 ring-4 ring-primary/40"
            : playing
              ? "border-destructive/60 bg-destructive/10 animate-pulse"
              : "border-border bg-secondary hover:bg-secondary/80 focus-visible:ring-4 focus-visible:ring-primary/40 focus-visible:border-primary"
        }`}
      >
        <span className="text-base font-bold text-foreground">{caption}</span>

        {axes === "both" ? (
          <div className="grid grid-cols-3 grid-rows-3 gap-1">
            <span />
            <DirArrow active={pressed.has("up")}>↑</DirArrow>
            <span />
            <DirArrow active={pressed.has("left")}>←</DirArrow>
            <OkBox />
            <DirArrow active={pressed.has("right")}>→</DirArrow>
            <span />
            <DirArrow active={pressed.has("down")}>↓</DirArrow>
            <span />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <DirArrow active={pressed.has("up")}>↑</DirArrow>
            <OkBox />
            <DirArrow active={pressed.has("down")}>↓</DirArrow>
          </div>
        )}

        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
          {hintText}
        </span>
      </button>

      {debug && (
        <div className="w-full">
          <button
            type="button"
            onClick={() => setDebugOn((v) => !v)}
            onMouseDown={(e) => e.preventDefault()}
            className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground"
          >
            <span
              className={`relative h-4 w-7 rounded-full transition-colors ${
                debugOn ? "bg-primary" : "bg-secondary"
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-background transition-all ${
                  debugOn ? "left-3.5" : "left-0.5"
                }`}
              />
            </span>
            Remote debug
          </button>
          {debugOn && (
            <div className="mt-1 w-full rounded-lg border border-dashed border-border bg-card/50 p-2 text-left">
              {events.length === 0 ? (
                <p className="font-mono text-[11px] text-muted-foreground">
                  Focus the controller and move the remote ring…
                </p>
              ) : (
                <ul className="space-y-0.5 font-mono text-[11px]">
                  {events.map((line, i) => (
                    <li key={i} className={i === 0 ? "text-primary" : "text-muted-foreground"}>
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function OkBox() {
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-md bg-background/60 text-xs text-muted-foreground">
      OK
    </span>
  )
}

function DirArrow({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`flex h-10 w-10 items-center justify-center rounded-md text-xl font-bold transition-all ${
        active
          ? "scale-110 bg-primary text-primary-foreground shadow-lg shadow-primary/40"
          : "bg-background/60 text-muted-foreground"
      }`}
    >
      {children}
    </span>
  )
}
