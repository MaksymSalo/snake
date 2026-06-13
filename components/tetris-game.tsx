"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { GameController, type Dir4 } from "@/components/game-controller"

/* ------------------------------ Constants ------------------------------ */

const COLS = 10
const ROWS = 20
const CELL = 22
const W = COLS * CELL
const H = ROWS * CELL

const PREVIEW_CELL = 16
const PREVIEW_DIM = 4 * PREVIEW_CELL

type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L"
type Status = "idle" | "playing" | "over"
type Cell = string | null
type Matrix = number[][]
type Piece = { type: PieceType; matrix: Matrix; x: number; y: number }

// Base orientations (spawn state).
const SHAPES: Record<PieceType, Matrix> = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
}
const COLORS: Record<PieceType, string> = {
  I: "#22d3ee",
  O: "#fbbf24",
  T: "#a855f7",
  S: "#22c55e",
  Z: "#ef4444",
  J: "#3b82f6",
  L: "#f97316",
}
const TYPES: PieceType[] = ["I", "O", "T", "S", "Z", "J", "L"]

type SpeedKey = "chill" | "normal" | "fast" | "insane"
const SPEEDS: Record<SpeedKey, { label: string; mult: number }> = {
  chill: { label: "Chill", mult: 0.7 },
  normal: { label: "Normal", mult: 1.0 },
  fast: { label: "Fast", mult: 1.4 },
  insane: { label: "Insane", mult: 1.9 },
}

const LINE_SCORE = [0, 100, 300, 500, 800]

/* ----- C1. pure helpers ----- */

function rotateCW(m: Matrix): Matrix {
  const n = m.length
  const out: Matrix = Array.from({ length: n }, () => Array(n).fill(0))
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      out[c][n - 1 - r] = m[r][c]
    }
  }
  return out
}

// Filled cells of a matrix as {x,y} offsets relative to the piece origin.
function cellsOf(m: Matrix): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m[r].length; c++) {
      if (m[r][c]) out.push({ x: c, y: r })
    }
  }
  return out
}

function collides(board: Cell[][], matrix: Matrix, px: number, py: number): boolean {
  for (const { x, y } of cellsOf(matrix)) {
    const gx = px + x
    const gy = py + y
    if (gx < 0 || gx >= COLS || gy >= ROWS) return true
    if (gy >= 0 && board[gy][gx]) return true
  }
  return false
}

function emptyBoard(): Cell[][] {
  return Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null))
}

/* ------------------------------- Component ------------------------------ */

export function TetrisGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<Status>("idle")
  const [score, setScore] = useState(0)
  const [lines, setLines] = useState(0)
  const [level, setLevel] = useState(1)
  const [highScore, setHighScore] = useState(0)
  const [speed, setSpeed] = useState<SpeedKey>("normal")

  // mutable game state
  const statusRef = useRef<Status>("idle")
  const speedRef = useRef<SpeedKey>("normal")
  const levelRef = useRef<number>(1)
  const boardRef = useRef<Cell[][]>(emptyBoard())
  const curRef = useRef<Piece | null>(null)
  const nextRef = useRef<PieceType>("I")
  const accRef = useRef<number>(0) // gravity accumulator (ms)

  useEffect(() => { statusRef.current = status }, [status])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { levelRef.current = level }, [level])

  // Gravity interval: faster with speed preset and level.
  const gravityMs = useCallback(() => {
    const base = 800 / SPEEDS[speedRef.current].mult
    return Math.max(70, base * Math.pow(0.85, levelRef.current - 1))
  }, [])

  /* ----- C3. draw ----- */

  const drawCell = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, ghost = false) => {
    if (ghost) {
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.5
      ctx.lineWidth = 2
      ctx.strokeRect(x + 2, y + 2, size - 4, size - 4)
      ctx.globalAlpha = 1
      return
    }
    ctx.fillStyle = color
    ctx.fillRect(x + 1, y + 1, size - 2, size - 2)
    // bevel
    ctx.fillStyle = "rgba(255,255,255,0.25)"
    ctx.fillRect(x + 1, y + 1, size - 2, 3)
    ctx.fillStyle = "rgba(0,0,0,0.25)"
    ctx.fillRect(x + 1, y + size - 4, size - 2, 3)
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const styles = getComputedStyle(document.documentElement)
    const bg = styles.getPropertyValue("--card").trim() || "#1a201c"
    const border = styles.getPropertyValue("--border").trim() || "#333"

    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // grid
    ctx.strokeStyle = border
    ctx.globalAlpha = 0.35
    ctx.lineWidth = 1
    for (let c = 1; c < COLS; c++) {
      ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, H); ctx.stroke()
    }
    for (let r = 1; r < ROWS; r++) {
      ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(W, r * CELL); ctx.stroke()
    }
    ctx.globalAlpha = 1

    // locked cells
    const board = boardRef.current
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const color = board[r][c]
        if (color) drawCell(ctx, c * CELL, r * CELL, CELL, color)
      }
    }

    // current piece + ghost
    const cur = curRef.current
    if (cur) {
      const color = COLORS[cur.type]
      // ghost: drop position
      let gy = cur.y
      while (!collides(board, cur.matrix, cur.x, gy + 1)) gy++
      for (const { x, y } of cellsOf(cur.matrix)) {
        const ry = gy + y
        if (ry >= 0) drawCell(ctx, (cur.x + x) * CELL, ry * CELL, CELL, color, true)
      }
      // actual piece
      for (const { x, y } of cellsOf(cur.matrix)) {
        const ry = cur.y + y
        if (ry >= 0) drawCell(ctx, (cur.x + x) * CELL, ry * CELL, CELL, color)
      }
    }

    // border
    ctx.strokeStyle = border
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, W - 2, H - 2)

    // next-piece preview
    const pc = previewRef.current
    if (pc) {
      const pctx = pc.getContext("2d")
      if (pctx) {
        pctx.clearRect(0, 0, PREVIEW_DIM, PREVIEW_DIM)
        const m = SHAPES[nextRef.current]
        const cells = cellsOf(m)
        const minX = Math.min(...cells.map((p) => p.x))
        const maxX = Math.max(...cells.map((p) => p.x))
        const minY = Math.min(...cells.map((p) => p.y))
        const maxY = Math.max(...cells.map((p) => p.y))
        const w = (maxX - minX + 1) * PREVIEW_CELL
        const h = (maxY - minY + 1) * PREVIEW_CELL
        const ox = (PREVIEW_DIM - w) / 2
        const oy = (PREVIEW_DIM - h) / 2
        for (const { x, y } of cells) {
          drawCell(pctx, ox + (x - minX) * PREVIEW_CELL, oy + (y - minY) * PREVIEW_CELL, PREVIEW_CELL, COLORS[nextRef.current])
        }
      }
    }
  }, [])

  /* ----- C2 + C4: spawn / lock / clear lines ----- */

  const randomType = (): PieceType => TYPES[Math.floor(Math.random() * TYPES.length)]

  const spawn = useCallback(() => {
    const type = nextRef.current
    nextRef.current = randomType()
    const matrix = SHAPES[type]
    const x = Math.floor((COLS - matrix.length) / 2)
    // Offset so the piece's top filled row sits at y=0.
    const firstRow = Math.min(...cellsOf(matrix).map((p) => p.y))
    const piece: Piece = { type, matrix, x, y: -firstRow }
    if (collides(boardRef.current, piece.matrix, piece.x, piece.y)) {
      setStatus("over")
      curRef.current = null
      return
    }
    curRef.current = piece
  }, [])

  const clearLines = useCallback(() => {
    const board = boardRef.current
    let cleared = 0
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[r].every((c) => c !== null)) {
        board.splice(r, 1)
        board.unshift(Array<Cell>(COLS).fill(null))
        cleared++
        r++ // re-check the same row index after shift
      }
    }
    if (cleared > 0) {
      setLines((prev) => {
        const total = prev + cleared
        const newLevel = 1 + Math.floor(total / 10)
        setLevel((lv) => (newLevel > lv ? newLevel : lv))
        return total
      })
      setScore((s) => {
        const nx = s + LINE_SCORE[cleared] * levelRef.current
        setHighScore((h) => (nx > h ? nx : h))
        return nx
      })
    }
  }, [])

  const lockPiece = useCallback(() => {
    const cur = curRef.current
    if (!cur) return
    const board = boardRef.current
    for (const { x, y } of cellsOf(cur.matrix)) {
      const gy = cur.y + y
      const gx = cur.x + x
      if (gy >= 0 && gy < ROWS && gx >= 0 && gx < COLS) board[gy][gx] = COLORS[cur.type]
    }
    clearLines()
    spawn()
  }, [clearLines, spawn])

  /* ----- C5: moves / rotate / drops ----- */

  const tryMove = useCallback((dx: number, dy: number): boolean => {
    const cur = curRef.current
    if (!cur) return false
    if (!collides(boardRef.current, cur.matrix, cur.x + dx, cur.y + dy)) {
      cur.x += dx
      cur.y += dy
      return true
    }
    return false
  }, [])

  const rotate = useCallback(() => {
    const cur = curRef.current
    if (!cur || cur.type === "O") return
    const rotated = rotateCW(cur.matrix)
    for (const kick of [0, -1, 1, -2, 2]) {
      if (!collides(boardRef.current, rotated, cur.x + kick, cur.y)) {
        cur.matrix = rotated
        cur.x += kick
        return
      }
    }
  }, [])

  const softDrop = useCallback(() => {
    if (tryMove(0, 1)) {
      accRef.current = 0
      setScore((s) => s + 1)
    } else {
      lockPiece()
    }
  }, [tryMove, lockPiece])

  const hardDrop = useCallback(() => {
    const cur = curRef.current
    if (!cur) return
    let dropped = 0
    while (tryMove(0, 1)) dropped++
    if (dropped > 0) setScore((s) => s + dropped * 2)
    lockPiece()
    accRef.current = 0
  }, [tryMove, lockPiece])

  const gravityStep = useCallback(() => {
    if (!tryMove(0, 1)) lockPiece()
  }, [tryMove, lockPiece])

  /* ----- C6: start ----- */

  const startGame = useCallback(() => {
    boardRef.current = emptyBoard()
    nextRef.current = randomType()
    accRef.current = 0
    setLevel(1)
    levelRef.current = 1
    setScore(0)
    setLines(0)
    setStatus("playing")
    spawn()
  }, [spawn])

  /* ----- C7: rAF loop with gravity accumulator ----- */

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      const elapsed = now - last
      last = now
      if (statusRef.current === "playing") {
        accRef.current += elapsed
        const interval = gravityMs()
        while (accRef.current >= interval) {
          accRef.current -= interval
          gravityStep()
          if (statusRef.current !== "playing") break
        }
      }
      draw()
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [draw, gravityMs, gravityStep])

  /* ----- D: input handlers ----- */

  const handlePress = useCallback((dir: Dir4) => {
    if (statusRef.current !== "playing") return
    if (dir === "left") tryMove(-1, 0)
    else if (dir === "right") tryMove(1, 0)
    else if (dir === "down") softDrop()
    else if (dir === "up") rotate()
  }, [tryMove, softDrop, rotate])

  const handleOk = useCallback(() => {
    if (statusRef.current === "playing") hardDrop()
    else startGame()
  }, [hardDrop, startGame])

  /* -------------------------------- Render ------------------------------- */

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-4">
      {/* Header / score */}
      <div className="flex w-full items-center justify-between">
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Score</span>
          <span className="font-mono text-2xl font-bold text-primary tabular-nums">{score}</span>
        </div>
        <div className="flex flex-col items-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Tetris</h1>
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Level <span className="text-primary">{level}</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Lines</span>
            <span className="font-mono text-2xl font-bold text-foreground tabular-nums">{lines}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Best</span>
            <span className="font-mono text-2xl font-bold text-accent tabular-nums">{highScore}</span>
          </div>
        </div>
      </div>

      {/* Speed selector */}
      <div className="flex w-full items-center justify-center gap-1">
        <span className="mr-1 text-[10px] uppercase tracking-widest text-muted-foreground">Speed</span>
        {(Object.keys(SPEEDS) as SpeedKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setSpeed(key)}
            className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
              speed === key
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            {SPEEDS[key].label}
          </button>
        ))}
      </div>

      {/* Board + next preview */}
      <div className="flex items-start gap-4">
        <div className="relative rounded-xl border border-border bg-card p-2 shadow-lg">
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className="block max-w-full rounded-lg"
            style={{ width: W, maxWidth: "100%", aspectRatio: `${W} / ${H}`, height: "auto" }}
            aria-label="Tetris game board"
          />

          {status !== "playing" && (
            <div className="absolute inset-2 flex flex-col items-center justify-center gap-3 rounded-lg bg-card/85 backdrop-blur-sm">
              {status === "over" && (
                <div className="text-center">
                  <p className="text-2xl font-bold text-destructive">Game Over</p>
                  <p className="text-sm text-muted-foreground">Final score: {score}</p>
                </div>
              )}
              {status === "idle" && (
                <p className="px-6 text-center text-sm text-muted-foreground text-pretty">
                  Stack the falling blocks and clear full lines. ◄ ► move · ▲ rotate · ▼ soft drop · OK hard drop.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Click the Controller below to {status === "idle" ? "start" : "play again"}.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Next</span>
          <div className="rounded-lg border border-border bg-card p-2 shadow">
            <canvas
              ref={previewRef}
              width={PREVIEW_DIM}
              height={PREVIEW_DIM}
              className="block"
              aria-label="Next piece"
            />
          </div>
        </div>
      </div>

      {/* Shared controller — 4-way pad, OK hard-drops. */}
      <GameController
        axes="both"
        mode="tap"
        status={status}
        widthClass="max-w-md"
        onPress={handlePress}
        onOk={handleOk}
        labels={{ active: "Controller active — rotate & drop" }}
        hint={{ active: "◄►move · ▲rotate · ▼drop · OK hard-drop" }}
      />
    </div>
  )
}
