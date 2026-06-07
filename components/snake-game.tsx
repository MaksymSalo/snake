"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"

const GRID_SIZE = 20 // cells per row/column
const CELL = 22 // px per cell
const BOARD = GRID_SIZE * CELL
const SPEED_MS = 110 // tick interval

type Point = { x: number; y: number }
type Direction = "up" | "down" | "left" | "right"
type Status = "idle" | "playing" | "over"

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

function randomFood(snake: Point[]): Point {
  while (true) {
    const food = {
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE),
    }
    if (!snake.some((s) => s.x === food.x && s.y === food.y)) return food
  }
}

export function SnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<Status>("idle")
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(0)

  // Mutable game state kept in refs so the game loop reads fresh values.
  const snakeRef = useRef<Point[]>(INITIAL_SNAKE)
  const foodRef = useRef<Point>({ x: 14, y: 10 })
  const dirRef = useRef<Direction>("right")
  const nextDirRef = useRef<Direction>("right")
  const statusRef = useRef<Status>("idle")

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
    const accent = styles.getPropertyValue("--accent").trim() || "#fbbf24"

    // Board background
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, BOARD, BOARD)

    // Grid lines
    ctx.strokeStyle = border
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

    // Food
    const food = foodRef.current
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 3, 0, Math.PI * 2)
    ctx.fill()

    // Snake
    const snake = snakeRef.current
    snake.forEach((seg, i) => {
      ctx.fillStyle = primary
      ctx.globalAlpha = i === 0 ? 1 : Math.max(0.45, 1 - i * 0.03)
      const pad = i === 0 ? 1 : 2
      const r = 5
      const x = seg.x * CELL + pad
      const y = seg.y * CELL + pad
      const w = CELL - pad * 2
      ctx.beginPath()
      ctx.roundRect(x, y, w, w, r)
      ctx.fill()
    })
    ctx.globalAlpha = 1
  }, [])

  const startGame = useCallback(() => {
    snakeRef.current = INITIAL_SNAKE.map((p) => ({ ...p }))
    foodRef.current = randomFood(snakeRef.current)
    dirRef.current = "right"
    nextDirRef.current = "right"
    setScore(0)
    setStatus("playing")
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

      const ate = newHead.x === foodRef.current.x && newHead.y === foodRef.current.y
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

    const id = setInterval(tick, SPEED_MS)
    return () => clearInterval(id)
  }, [status, draw])

  const changeDirection = useCallback((dir: Direction) => {
    if (statusRef.current !== "playing") return
    if (dir === OPPOSITE[dirRef.current]) return
    nextDirRef.current = dir
  }, [])

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
    // Tizen / standard TV remote numeric key codes
    const codeMap: Record<number, Direction> = {
      38: "up", // ArrowUp
      40: "down", // ArrowDown
      37: "left", // ArrowLeft
      39: "right", // ArrowRight
    }
    // OK/Enter (13), Play (415), and Pause (19) start the game.
    const START_CODES = new Set([13, 415, 19])
    // Back/Return on Samsung TV remote (10009) — left here for completeness.

    const handler = (e: KeyboardEvent) => {
      const dir = keyMap[e.key] ?? codeMap[e.keyCode]
      if (dir) {
        e.preventDefault()
        changeDirection(dir)
        return
      }

      const isStartKey =
        e.key === " " || e.key === "Enter" || START_CODES.has(e.keyCode)
      if (isStartKey && statusRef.current !== "playing") {
        e.preventDefault()
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

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
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

      <div className="relative rounded-xl border border-border bg-card p-2 shadow-lg">
        <canvas
          ref={canvasRef}
          width={BOARD}
          height={BOARD}
          className="block max-w-full rounded-lg"
          style={{ width: BOARD, maxWidth: "100%", aspectRatio: "1 / 1", height: "auto" }}
          aria-label="Snake game board"
        />

        {status !== "playing" && (
          <div className="absolute inset-2 flex flex-col items-center justify-center gap-4 rounded-lg bg-card/85 backdrop-blur-sm">
            {status === "over" && (
              <div className="text-center">
                <p className="text-xl font-bold text-destructive">Game Over</p>
                <p className="text-sm text-muted-foreground">You scored {score}</p>
              </div>
            )}
            {status === "idle" && (
              <p className="px-6 text-center text-sm text-muted-foreground text-pretty">
                Use arrow keys or WASD to steer. Eat the food to grow.
              </p>
            )}
            <Button size="lg" onClick={startGame}>
              {status === "over" ? "Play Again" : "Start Game"}
            </Button>
          </div>
        )}
      </div>

      {/* On-screen controls for touch / mobile */}
      <div className="grid grid-cols-3 gap-2 sm:hidden" aria-hidden="true">
        <div />
        <ControlButton label="Up" onPress={() => changeDirection("up")}>↑</ControlButton>
        <div />
        <ControlButton label="Left" onPress={() => changeDirection("left")}>←</ControlButton>
        <ControlButton label="Down" onPress={() => changeDirection("down")}>↓</ControlButton>
        <ControlButton label="Right" onPress={() => changeDirection("right")}>→</ControlButton>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Controls: Arrow keys, WASD, or TV remote D-pad · Space / OK to start
      </p>
    </div>
  )
}

function ControlButton({
  children,
  onPress,
  label,
}: {
  children: React.ReactNode
  onPress: () => void
  label: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      className="flex h-14 w-14 items-center justify-center rounded-lg border border-border bg-secondary text-xl text-secondary-foreground active:bg-primary active:text-primary-foreground"
    >
      {children}
    </button>
  )
}