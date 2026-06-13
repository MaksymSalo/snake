"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { GameController } from "@/components/game-controller"

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
  }, [])

  // Controller OK / Enter / Space — start (or restart) when not playing.
  const handleOk = useCallback(() => {
    if (statusRef.current !== "playing") startGame()
  }, [startGame])

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
  }, [])

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

      {/* Shared controller — owns all the TV-remote plumbing. */}
      <GameController
        axes="both"
        mode="tap"
        status={status}
        onPress={changeDirection}
        onOk={handleOk}
        debug
        labels={{ active: "Controller active — swipe the remote ring" }}
      />
    </div>
  )
}