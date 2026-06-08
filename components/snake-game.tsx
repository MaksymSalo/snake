"use client"

import { useCallback, useEffect, useRef, useState } from "react"

const GRID_SIZE = 20 // cells per row/column
const CELL = 22 // px per cell
const BOARD = GRID_SIZE * CELL

type Point = { x: number; y: number }
type Direction = "up" | "down" | "left" | "right"
type Status = "idle" | "playing" | "over"
type SpeedKey = "chill" | "normal" | "fast" | "insane"

const SPEEDS: Record<SpeedKey, { label: string; ms: number }> = {
  chill: { label: "Chill", ms: 210 },
  normal: { label: "Normal", ms: 160 },
  fast: { label: "Fast", ms: 100 },
  insane: { label: "Insane", ms: 65 },
}

const FRUITS = ["🍎", "🍌", "🍇", "🍒", "🍓", "🍊", "🥝", "🍉", "🍑", "🥭", "🍍", "🫐"]
const pickFruit = () => FRUITS[Math.floor(Math.random() * FRUITS.length)]

type Food = { pos: Point; emoji: string }

const DIRECTIONS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
}

const INITIAL_SNAKE: Point[] = [
  { x: 8, y: 10 },
  { x: 7, y: 10 },
  { x: 6, y: 10 },
]

function randomFood(snake: Point[]): Food {
  while (true) {
    const pos = {
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE),
    }
    if (!snake.some((s) => s.x === pos.x && s.y === pos.y)) {
      return { pos, emoji: pickFruit() }
    }
  }
}

export function SnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<Status>("idle")
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(0)
  const [speed, setSpeed] = useState<SpeedKey>("normal")

  // Mutable game state kept in refs so the game loop reads fresh values.
  const snakeRef = useRef<Point[]>(INITIAL_SNAKE)
  const foodRef = useRef<Food>({ pos: { x: 14, y: 10 }, emoji: "🍎" })
  const dirRef = useRef<Direction>("right")
  const nextDirRef = useRef<Direction>("right")
  const statusRef = useRef<Status>("idle")
  // Death animation: 0 → no animation, otherwise frame counter (0..1)
  const deathRef = useRef<number>(0)
  // Swipe gesture state (TV cursor / touch)
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null)
  // Controller: focus + last-pressed direction (for visual feedback)
  const controllerRef = useRef<HTMLButtonElement>(null)
  const [controllerFocused, setControllerFocused] = useState(false)
  const [lastDir, setLastDir] = useState<Direction | null>(null)
  const lastDirTimerRef = useRef<number | null>(null)
  const flashDir = useCallback((dir: Direction) => {
    setLastDir(dir)
    if (lastDirTimerRef.current) window.clearTimeout(lastDirTimerRef.current)
    lastDirTimerRef.current = window.setTimeout(() => setLastDir(null), 180)
  }, [])
  // Debug: last few raw events that arrived at the controller. Helps figure
  // out what the Samsung remote actually sends on this TV / firmware.
  const [debugEvents, setDebugEvents] = useState<string[]>([])
  const pushDebug = useCallback((line: string) => {
    setDebugEvents((prev) => [line, ...prev].slice(0, 6))
  }, [])
  // Virtual-pointer tracking for ring-as-trackpad firmware
  const pointerAccumRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  useEffect(() => {
    statusRef.current = status
  }, [status])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const styles = getComputedStyle(document.documentElement)
    const bg = styles.getPropertyValue("--card").trim() || "#1a201c"
    const border = styles.getPropertyValue("--border").trim() || "#333"
    const primary = styles.getPropertyValue("--primary").trim() || "#4ade80"
    const destructive = styles.getPropertyValue("--destructive").trim() || "#ef4444"

    // Checker-pattern board background (slightly nicer than plain)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, BOARD, BOARD)
    ctx.fillStyle = "rgba(255,255,255,0.025)"
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if ((x + y) % 2 === 0) ctx.fillRect(x * CELL, y * CELL, CELL, CELL)
      }
    }

    // Subtle grid lines
    ctx.strokeStyle = border
    ctx.globalAlpha = 0.4
    ctx.lineWidth = 1
    for (let i = 1; i < GRID_SIZE; i++) {
      ctx.beginPath()
      ctx.moveTo(i * CELL, 0)
      ctx.lineTo(i * CELL, BOARD)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i * CELL)
      ctx.lineTo(BOARD, i * CELL)
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    // Food — emoji sprite with a soft glow
    const food = foodRef.current
    const fcx = food.pos.x * CELL + CELL / 2
    const fcy = food.pos.y * CELL + CELL / 2
    const pulse = 1 + Math.sin(Date.now() / 250) * 0.08
    ctx.save()
    // Soft glow underneath (drawn as a separate circle so it doesn't
    // muddle the colored-emoji glyph itself, which Chrome renders as a bitmap)
    const grad = ctx.createRadialGradient(fcx, fcy, 1, fcx, fcy, CELL * 0.8)
    grad.addColorStop(0, "rgba(255,200,80,0.45)")
    grad.addColorStop(1, "rgba(255,200,80,0)")
    ctx.fillStyle = grad
    ctx.fillRect(fcx - CELL, fcy - CELL, CELL * 2, CELL * 2)

    ctx.font = `${Math.floor(CELL * 0.95 * pulse)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",system-ui,sans-serif`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(food.emoji, fcx, fcy + 1)
    ctx.restore()

    // Snake
    const snake = snakeRef.current
    const dying = deathRef.current
    const headDir = dirRef.current

    // Body: rounded segments with a gradient + scales
    for (let i = snake.length - 1; i >= 0; i--) {
      const seg = snake[i]
      const isHead = i === 0
      const t = i / Math.max(1, snake.length - 1) // 0 at head, 1 at tail
      const pad = isHead ? 1 : 2
      const x = seg.x * CELL + pad
      const y = seg.y * CELL + pad
      const w = CELL - pad * 2
      const r = isHead ? 7 : 6

      // Color: green→darker green along body. Red wash during death.
      const tintR = dying > 0 ? Math.min(255, 80 + dying * 175) : 0
      const baseR = 74 + Math.floor((1 - t) * 30) + tintR * 0.7
      const baseG = dying > 0 ? Math.max(50, 222 - dying * 170) : 222 - Math.floor(t * 80)
      const baseB = dying > 0 ? Math.max(40, 128 - dying * 80) : 128 - Math.floor(t * 40)
      ctx.fillStyle = `rgb(${Math.min(255, baseR)}, ${baseG}, ${baseB})`
      ctx.beginPath()
      ctx.roundRect(x, y, w, w, r)
      ctx.fill()

      // Scale highlight
      if (!isHead) {
        ctx.fillStyle = `rgba(255,255,255,${0.08 - t * 0.05})`
        ctx.beginPath()
        ctx.arc(x + w / 2, y + w / 2, w * 0.28, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Head details — eyes pointing in current direction
    if (snake.length > 0) {
      const head = snake[0]
      const hx = head.x * CELL + CELL / 2
      const hy = head.y * CELL + CELL / 2
      const eyeOffset = CELL * 0.22
      const eyeR = CELL * 0.11
      const pupilR = CELL * 0.06
      // Perpendicular axis for eye placement
      let ex1 = 0, ey1 = 0, ex2 = 0, ey2 = 0
      let pdx = 0, pdy = 0
      if (headDir === "right") { ex1 = eyeOffset; ey1 = -eyeOffset; ex2 = eyeOffset; ey2 = eyeOffset; pdx = pupilR * 0.6 }
      if (headDir === "left")  { ex1 = -eyeOffset; ey1 = -eyeOffset; ex2 = -eyeOffset; ey2 = eyeOffset; pdx = -pupilR * 0.6 }
      if (headDir === "up")    { ex1 = -eyeOffset; ey1 = -eyeOffset; ex2 = eyeOffset; ey2 = -eyeOffset; pdy = -pupilR * 0.6 }
      if (headDir === "down")  { ex1 = -eyeOffset; ey1 = eyeOffset; ex2 = eyeOffset; ey2 = eyeOffset; pdy = pupilR * 0.6 }

      ctx.fillStyle = "#ffffff"
      ctx.beginPath(); ctx.arc(hx + ex1, hy + ey1, eyeR, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(hx + ex2, hy + ey2, eyeR, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = dying > 0 ? "#ff2222" : "#0a0a0a"
      ctx.beginPath(); ctx.arc(hx + ex1 + pdx, hy + ey1 + pdy, pupilR, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(hx + ex2 + pdx, hy + ey2 + pdy, pupilR, 0, Math.PI * 2); ctx.fill()

      // X eyes when dead
      if (dying >= 0.99) {
        ctx.strokeStyle = "#0a0a0a"
        ctx.lineWidth = 2
        const drawX = (cx: number, cy: number) => {
          const s = eyeR * 0.9
          ctx.beginPath(); ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s); ctx.stroke()
        }
        ctx.fillStyle = "#ffffff"
        ctx.beginPath(); ctx.arc(hx + ex1, hy + ey1, eyeR, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(hx + ex2, hy + ey2, eyeR, 0, Math.PI * 2); ctx.fill()
        drawX(hx + ex1, hy + ey1)
        drawX(hx + ex2, hy + ey2)
      }
    }

    // Red flash overlay during death
    if (dying > 0) {
      ctx.fillStyle = destructive
      ctx.globalAlpha = 0.15 * (1 - dying) + 0.05
      ctx.fillRect(0, 0, BOARD, BOARD)
      ctx.globalAlpha = 1
    }

    // Avoid "unused var" complaints for primary
    void primary
  }, [])

  const startGame = useCallback(() => {
    snakeRef.current = INITIAL_SNAKE.map((p) => ({ ...p }))
    foodRef.current = randomFood(snakeRef.current)
    dirRef.current = "right"
    nextDirRef.current = "right"
    deathRef.current = 0
    setScore(0)
    setStatus("playing")
    // Move focus to the Controller button so the Samsung TV remote enters
    // "directional input capture" mode (blue arrow indicator appears) and
    // every ring swipe lands as a keydown on the controller.
    requestAnimationFrame(() => {
      controllerRef.current?.focus()
    })
  }, [])

  // Game loop
  useEffect(() => {
    if (status !== "playing") {
      draw()
      return
    }

    const tick = () => {
      const dir = nextDirRef.current
      dirRef.current = dir
      const delta = DIRECTIONS[dir]
      const snake = snakeRef.current
      const head = snake[0]
      const newHead = { x: head.x + delta.x, y: head.y + delta.y }

      // Wall collision
      if (newHead.x < 0 || newHead.x >= GRID_SIZE || newHead.y < 0 || newHead.y >= GRID_SIZE) {
        setStatus("over")
        return
      }
      // Self collision
      if (snake.some((s) => s.x === newHead.x && s.y === newHead.y)) {
        setStatus("over")
        return
      }

      const ate = newHead.x === foodRef.current.pos.x && newHead.y === foodRef.current.pos.y
      const newSnake = [newHead, ...snake]
      if (ate) {
        foodRef.current = randomFood(newSnake)
        setScore((s) => {
          const next = s + 1
          setHighScore((h) => (next > h ? next : h))
          return next
        })
      } else {
        newSnake.pop()
      }
      snakeRef.current = newSnake
      draw()
    }

    const id = setInterval(tick, SPEEDS[speed].ms)
    return () => clearInterval(id)
  }, [status, draw, speed])

  // Death animation: ~700ms red flash + shake + X eyes
  useEffect(() => {
    if (status !== "over") {
      deathRef.current = 0
      return
    }
    const start = performance.now()
    const DURATION = 700
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION)
      deathRef.current = t
      draw()
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [status, draw])

  const changeDirection = useCallback((dir: Direction) => {
    if (statusRef.current !== "playing") return
    if (dir === OPPOSITE[dirRef.current]) return
    nextDirRef.current = dir
    flashDir(dir)
  }, [flashDir])

  // Keyboard + Samsung TV (Tizen) remote controls
  useEffect(() => {
    // Samsung Tizen remotes send the D-pad as standard arrow keys, but some
    // TV browser builds only populate `keyCode`. We match on both `e.key`
    // and the numeric `keyCode` so the remote works reliably on a TV.
    const keyMap: Record<string, Direction> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      w: "up",
      s: "down",
      a: "left",
      d: "right",
    }
    // Tizen / standard TV remote numeric key codes.
    // Samsung Smart TVs use the standard 37/38/39/40 for the D-pad, but some
    // older / web-browser builds use the 295xx range — accept both.
    const codeMap: Record<number, Direction> = {
      38: "up",
      40: "down",
      37: "left",
      39: "right",
      29460: "up",
      29461: "down",
      29462: "left",
      29463: "right",
    }
    // OK/Enter (13), Play (415), Pause (19), Tizen MediaPlayPause (10252)
    const START_CODES = new Set([13, 415, 19, 10252])

    const handler = (e: KeyboardEvent) => {
      const dir = keyMap[e.key] ?? codeMap[e.keyCode]
      if (dir) {
        // Capture phase + stopPropagation prevents the Radix Tabs trigger
        // (when still focused) from swallowing the arrow keys to switch tabs.
        e.preventDefault()
        e.stopPropagation()
        changeDirection(dir)
        return
      }

      const isStartKey =
        e.key === " " || e.key === "Enter" || START_CODES.has(e.keyCode)
      if (isStartKey && statusRef.current !== "playing") {
        e.preventDefault()
        e.stopPropagation()
        startGame()
      }
    }

    // Tizen exposes a key registration API; register the media keys we use so
    // the platform routes them to the page instead of the system. Guarded so
    // it is a no-op in normal browsers.
    const tizen = (window as unknown as { tizen?: any }).tizen
    try {
      tizen?.tvinputdevice?.registerKeyBatch?.([
        "MediaPlay",
        "MediaPause",
        "MediaPlayPause",
        "MediaStop",
      ])
    } catch {
      // ignore — not running on a Tizen TV
    }

    // Capture phase so we run BEFORE Radix Tabs' bubble-phase handler on the
    // focused TabsTrigger and can stop it from intercepting the D-pad.
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [changeDirection, startGame])

  // Initial draw
  useEffect(() => {
    draw()
  }, [draw])

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-5">
      <div className="flex w-full items-center justify-between">
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Score</span>
          <span className="font-mono text-3xl font-bold text-primary tabular-nums">{score}</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Snake</h1>
        <div className="flex flex-col items-end">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Best</span>
          <span className="font-mono text-3xl font-bold text-accent tabular-nums">{highScore}</span>
        </div>
      </div>

      {/* Speed selector */}
      <div className="flex w-full items-center justify-center gap-1.5">
        <span className="mr-1 text-xs uppercase tracking-widest text-muted-foreground">Speed</span>
        {(Object.keys(SPEEDS) as SpeedKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSpeed(key)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              speed === key
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            {SPEEDS[key].label}
          </button>
        ))}
      </div>

      <div
        className={`relative rounded-xl border border-border bg-card p-2 shadow-lg ${
          status === "over" ? "snake-shake" : ""
        }`}
      >
        <canvas
          ref={canvasRef}
          width={BOARD}
          height={BOARD}
          tabIndex={0}
          className="block max-w-full touch-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary"
          style={{ width: BOARD, maxWidth: "100%", aspectRatio: "1 / 1", height: "auto" }}
          aria-label="Snake game board"
          onPointerDown={(e) => {
            ;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId)
            swipeStartRef.current = { x: e.clientX, y: e.clientY }
          }}
          onPointerMove={(e) => {
            const start = swipeStartRef.current
            if (!start) return
            const dx = e.clientX - start.x
            const dy = e.clientY - start.y
            const THRESHOLD = 24
            if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return
            if (Math.abs(dx) > Math.abs(dy)) {
              changeDirection(dx > 0 ? "right" : "left")
            } else {
              changeDirection(dy > 0 ? "down" : "up")
            }
            swipeStartRef.current = { x: e.clientX, y: e.clientY }
          }}
          onPointerUp={() => { swipeStartRef.current = null }}
          onPointerCancel={() => { swipeStartRef.current = null }}
          onClick={() => {
            if (statusRef.current !== "playing") startGame()
          }}
        />

        {status !== "playing" && (
          <div
            className={`absolute inset-2 flex flex-col items-center justify-center gap-4 rounded-lg ${
              status === "over"
                ? "bg-card/30 backdrop-blur-[2px]"
                : "bg-card/85 backdrop-blur-sm"
            }`}
          >
            {status === "over" && (
              <div className="text-center">
                <p className="text-xl font-bold text-destructive">Game Over</p>
                <p className="text-sm text-muted-foreground">You scored {score}</p>
                <p className="mt-1 text-xs text-muted-foreground">Click the Controller below to play again.</p>
              </div>
            )}
            {status === "idle" && (
              <p className="px-6 text-center text-sm text-muted-foreground text-pretty">
                Click the green Controller below to start. The TV remote will then steer the snake.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Remote Controller — clicking it captures the Samsung TV remote ring.
          While focused, the TV shows its blue directional indicator and every
          swipe of the ring lands here as an arrow keydown. */}
      <button
        ref={controllerRef}
        type="button"
        onClick={() => {
          if (statusRef.current !== "playing") startGame()
          // Either way, keep focus on the controller.
          controllerRef.current?.focus()
        }}
        onFocus={() => setControllerFocused(true)}
        onBlur={() => setControllerFocused(false)}
        onKeyDown={(e) => {
          const map: Record<string, Direction> = {
            ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
            w: "up", s: "down", a: "left", d: "right",
          }
          const codeMap: Record<number, Direction> = {
            38: "up", 40: "down", 37: "left", 39: "right",
            29460: "up", 29461: "down", 29462: "left", 29463: "right",
          }
          pushDebug(`keydown key="${e.key}" code=${e.keyCode}`)
          const dir = map[e.key] ?? codeMap[e.keyCode]
          if (dir) {
            e.preventDefault()
            e.stopPropagation()
            changeDirection(dir)
            return
          }
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault()
            if (statusRef.current !== "playing") startGame()
          }
        }}
        // Some Samsung remotes deliver ring swipes as wheel events instead
        // of key events when the focused element captures input.
        onWheel={(e) => {
          pushDebug(`wheel dx=${Math.round(e.deltaX)} dy=${Math.round(e.deltaY)}`)
          const { deltaX, deltaY } = e
          if (Math.abs(deltaX) < 4 && Math.abs(deltaY) < 4) return
          e.preventDefault()
          if (Math.abs(deltaX) > Math.abs(deltaY)) {
            changeDirection(deltaX > 0 ? "right" : "left")
          } else {
            changeDirection(deltaY > 0 ? "down" : "up")
          }
        }}
        // Other firmware delivers ring as virtual pointer movement on the
        // focused element. Accumulate and translate to a direction once we
        // cross a threshold.
        onPointerMove={(e) => {
          if (e.pointerType === "mouse" && !e.buttons) {
            // Free hover from a real mouse — ignore.
          }
          pointerAccumRef.current.x += e.movementX || 0
          pointerAccumRef.current.y += e.movementY || 0
          const { x, y } = pointerAccumRef.current
          const TH = 28
          if (Math.abs(x) < TH && Math.abs(y) < TH) return
          if (Math.abs(x) > Math.abs(y)) {
            changeDirection(x > 0 ? "right" : "left")
          } else {
            changeDirection(y > 0 ? "down" : "up")
          }
          pushDebug(`pointer dx=${Math.round(x)} dy=${Math.round(y)}`)
          pointerAccumRef.current = { x: 0, y: 0 }
        }}
        onPointerLeave={() => { pointerAccumRef.current = { x: 0, y: 0 } }}
        aria-label="Game controller — click to start, then use the remote ring or arrow keys to steer"
        className={`flex w-full max-w-xs flex-col items-center gap-3 rounded-2xl border-2 p-5 outline-none transition-colors ${
          status === "playing" && controllerFocused
            ? "border-primary bg-primary/15 ring-4 ring-primary/40"
            : status === "playing"
              ? "border-destructive/60 bg-destructive/10 animate-pulse"
              : "border-border bg-secondary hover:bg-secondary/80 focus-visible:ring-4 focus-visible:ring-primary/40 focus-visible:border-primary"
        }`}
      >
        <span className="text-base font-bold text-foreground">
          {status === "playing"
            ? (controllerFocused ? "Controller active — swipe the remote ring" : "Click to take control")
            : status === "over"
              ? "Play Again"
              : "Start Game"}
        </span>

        {/* Directional indicator (3×3 grid of arrows) */}
        <div className="grid grid-cols-3 grid-rows-3 gap-1">
          <span />
          <DirArrow active={lastDir === "up"}>↑</DirArrow>
          <span />
          <DirArrow active={lastDir === "left"}>←</DirArrow>
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-background/60 text-xs text-muted-foreground">
            OK
          </span>
          <DirArrow active={lastDir === "right"}>→</DirArrow>
          <span />
          <DirArrow active={lastDir === "down"}>↓</DirArrow>
          <span />
        </div>

        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
          {status === "playing"
            ? (controllerFocused ? "TV remote · arrow keys · WASD" : "click here, then steer")
            : "press to begin"}
        </span>
      </button>

      {/* Debug strip — shows every event the controller actually receives.
          Use this on the TV to figure out what the remote fires. */}
      <div className="w-full max-w-xs rounded-lg border border-dashed border-border bg-card/50 p-2 text-left">
        <p className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
          Remote events (debug)
        </p>
        {debugEvents.length === 0 ? (
          <p className="font-mono text-[11px] text-muted-foreground">
            Focus the Controller and move the remote ring…
          </p>
        ) : (
          <ul className="space-y-0.5 font-mono text-[11px] text-foreground">
            {debugEvents.map((line, i) => (
              <li key={i} className={i === 0 ? "text-primary" : "text-muted-foreground"}>
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>

    </div>
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