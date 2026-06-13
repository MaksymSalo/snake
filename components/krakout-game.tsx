"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { GameController, type Dir4 } from "@/components/game-controller"

/* ------------------------------ Constants ------------------------------ */

const W = 520
const H = 360
const BAT_W = 10
const BAT_H = 60
const BAT_X = W - 28
const BALL_R = 6
const BRICK_W = 22
const BRICK_H = 16
const BRICK_COLS = 8
const BRICK_ROWS = 12
const BRICK_OX = 24 // left margin
const BRICK_OY = 24 // top margin
const BRICK_GAP = 2

type Brick = { x: number; y: number; alive: boolean; hits: number; maxHits: number }
type Status = "idle" | "playing" | "paused" | "over" | "cleared"
type Ball = { x: number; y: number; vx: number; vy: number; stuck: boolean; stuckOffset: number }
type PowerKind = "multi" | "wide" | "sticky"
type Capsule = { x: number; y: number; vx: number; vy: number; kind: PowerKind }

const POWER_DURATION_MS = 15000
const POWER_DROP_CHANCE = 0.18 // probability a destroyed brick drops a capsule
const POWER_COLORS: Record<PowerKind, string> = {
  multi: "#22c55e",   // green
  wide:  "#3b82f6",   // blue
  sticky:"#fbbf24",   // amber
}
const POWER_LABELS: Record<PowerKind, string> = {
  multi: "Multi-ball",
  wide:  "Wider bat",
  sticky:"Sticky bat",
}
const POWER_GLYPHS: Record<PowerKind, string> = {
  multi: "M",
  wide:  "W",
  sticky:"S",
}

// HP → color. Higher HP = cooler / metallic colors. Award scales with HP.
const BRICK_STYLES: Record<number, { fill: string; top: string; bottom: string; score: number }> = {
  1: { fill: "#f59e0b", top: "rgba(255,255,255,0.30)", bottom: "rgba(0,0,0,0.25)", score: 10 },  // amber
  2: { fill: "#3b82f6", top: "rgba(255,255,255,0.30)", bottom: "rgba(0,0,0,0.30)", score: 25 },  // blue
  3: { fill: "#a855f7", top: "rgba(255,255,255,0.35)", bottom: "rgba(0,0,0,0.35)", score: 50 },  // purple
}
type SpeedKey = "chill" | "normal" | "fast" | "insane"

const SPEEDS: Record<SpeedKey, { label: string; mult: number }> = {
  chill: { label: "Chill", mult: 0.7 },
  normal: { label: "Normal", mult: 1.0 },
  fast: { label: "Fast", mult: 1.4 },
  insane: { label: "Insane", mult: 1.9 },
}

// Cap level-driven difficulty so the board doesn't become 100% purple.
const MAX_DESIGNED_LEVEL = 8

function buildBricks(level: number): Brick[] {
  // Layout scales with level:
  // - Level 1: 2 purple cols, 3 blue cols, 3 amber cols.
  // - Each level shifts the purple/blue boundaries 0.5 cols to the right,
  //   so by level 6+ the whole board is 3-hit bricks.
  // - We also start carving "gap" patterns on higher levels so the field
  //   looks different — every other row gets a missing column.
  const lvl = Math.min(level, MAX_DESIGNED_LEVEL)
  const purpleUntil = 2 + (lvl - 1) * 0.6
  const blueUntil = 5 + (lvl - 1) * 0.4
  const out: Brick[] = []
  for (let r = 0; r < BRICK_ROWS; r++) {
    for (let c = 0; c < BRICK_COLS; c++) {
      // Carve simple "checker" gaps starting at level 3: skip one brick per row.
      if (lvl >= 3 && ((r + c) % (8 - Math.min(4, lvl - 2))) === 0 && c >= 1 && c <= BRICK_COLS - 2) {
        continue
      }
      const maxHits = c < purpleUntil ? 3 : c < blueUntil ? 2 : 1
      out.push({
        x: BRICK_OX + c * (BRICK_W + BRICK_GAP),
        y: BRICK_OY + r * (BRICK_H + BRICK_GAP),
        alive: true,
        hits: maxHits,
        maxHits,
      })
    }
  }
  return out
}

/* ------------------------------- Component ------------------------------ */

export function KrakoutGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<Status>("idle")
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(0)
  const [lives, setLives] = useState(3)
  const [level, setLevel] = useState(1)
  const [speed, setSpeed] = useState<SpeedKey>("normal")

  // mutable game state
  const statusRef = useRef<Status>("idle")
  const speedRef = useRef<SpeedKey>("normal")
  const levelRef = useRef<number>(1)
  const bricksRef = useRef<Brick[]>(buildBricks(1))
  const batYRef = useRef<number>(H / 2 - BAT_H / 2)
  const batVRef = useRef<number>(0) // -1 up, +1 down, 0 idle
  const ballsRef = useRef<Ball[]>([
    { x: W / 2, y: H / 2, vx: -3, vy: 1.5, stuck: false, stuckOffset: 0 },
  ])
  const capsulesRef = useRef<Capsule[]>([])
  // Power-up expiry timestamps (ms; 0 = inactive).
  const effectsRef = useRef<{ wide: number; sticky: number }>({ wide: 0, sticky: 0 })
  // Mirror in state so the UI can render timer bars.
  const [effects, setEffects] = useState<{ wide: number; sticky: number }>({ wide: 0, sticky: 0 })
  // Tick UI clock so timer bars re-render smoothly.
  const [, setUiClock] = useState(0)

  useEffect(() => { statusRef.current = status }, [status])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { levelRef.current = level }, [level])

  // (Auto-advance + UI-clock effects moved below their callback dependencies.)

  // Speed scales 7% per level on top of the user's chosen speed preset.
  const levelMult = (lvl: number) => 1 + (lvl - 1) * 0.07

  // Effective bat half-height (extended by Wide power-up).
  const currentBatH = () => (effectsRef.current.wide > performance.now() ? BAT_H * 1.6 : BAT_H)

  // Activate (or extend) a power-up.
  const activatePower = useCallback((kind: PowerKind) => {
    const now = performance.now()
    if (kind === "multi") {
      // Split each live ball into 3 (original + two angled copies).
      const extra: Ball[] = []
      for (const b of ballsRef.current) {
        if (b.stuck) continue
        const speed = Math.hypot(b.vx, b.vy) || 4
        const baseAngle = Math.atan2(b.vy, b.vx)
        for (const da of [-0.45, 0.45]) {
          const a = baseAngle + da
          extra.push({
            x: b.x, y: b.y,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            stuck: false, stuckOffset: 0,
          })
        }
      }
      ballsRef.current = [...ballsRef.current, ...extra].slice(0, 8)
      return
    }
    const until = now + POWER_DURATION_MS
    effectsRef.current[kind] = until
    setEffects({ ...effectsRef.current })
  }, [])

  /* ----- Drawing ----- */

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const styles = getComputedStyle(document.documentElement)
    const bg = styles.getPropertyValue("--card").trim() || "#1a201c"
    const border = styles.getPropertyValue("--border").trim() || "#333"

    // background
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)
    // faint vertical stripes
    ctx.fillStyle = "rgba(255,255,255,0.02)"
    for (let i = 0; i < W; i += 16) ctx.fillRect(i, 0, 8, H)

    // border
    ctx.strokeStyle = border
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, W - 2, H - 2)

    // bricks
    for (const b of bricksRef.current) {
      if (!b.alive) continue
      const style = BRICK_STYLES[b.hits] ?? BRICK_STYLES[1]
      ctx.fillStyle = style.fill
      ctx.fillRect(b.x, b.y, BRICK_W, BRICK_H)
      // bevel
      ctx.fillStyle = style.top
      ctx.fillRect(b.x, b.y, BRICK_W, 3)
      ctx.fillStyle = style.bottom
      ctx.fillRect(b.x, b.y + BRICK_H - 3, BRICK_W, 3)
      // little HP pip dots in the corner for 2/3-hit bricks
      if (b.maxHits > 1) {
        ctx.fillStyle = "rgba(255,255,255,0.9)"
        for (let i = 0; i < b.hits; i++) {
          ctx.fillRect(b.x + 3 + i * 3, b.y + BRICK_H / 2 - 1, 2, 2)
        }
      }
    }

    // bat (right side, possibly stretched by Wide power-up)
    const now = performance.now()
    const batH = effectsRef.current.wide > now ? BAT_H * 1.6 : BAT_H
    const sticky = effectsRef.current.sticky > now
    const by = batYRef.current
    const batGrad = ctx.createLinearGradient(BAT_X, 0, BAT_X + BAT_W, 0)
    if (sticky) {
      batGrad.addColorStop(0, "#fde68a")
      batGrad.addColorStop(1, "#f59e0b")
    } else {
      batGrad.addColorStop(0, "#86efac")
      batGrad.addColorStop(1, "#16a34a")
    }
    ctx.fillStyle = batGrad
    ctx.fillRect(BAT_X, by, BAT_W, batH)
    ctx.fillStyle = "rgba(255,255,255,0.25)"
    ctx.fillRect(BAT_X, by, BAT_W, 3)

    // capsules
    for (const cap of capsulesRef.current) {
      ctx.fillStyle = POWER_COLORS[cap.kind]
      ctx.beginPath()
      ctx.roundRect(cap.x - 10, cap.y - 6, 20, 12, 6)
      ctx.fill()
      ctx.fillStyle = "rgba(0,0,0,0.75)"
      ctx.font = "bold 10px monospace"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(POWER_GLYPHS[cap.kind], cap.x, cap.y + 1)
    }

    // balls
    for (const ball of ballsRef.current) {
      ctx.fillStyle = "#fbbf24"
      ctx.beginPath()
      ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = "rgba(255,255,255,0.55)"
      ctx.beginPath()
      ctx.arc(ball.x - 2, ball.y - 2, BALL_R / 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [])

  /* ----- Reset / start ----- */

  const resetBallAndBat = useCallback(() => {
    batYRef.current = H / 2 - BAT_H / 2
    batVRef.current = 0
    const lm = levelMult(levelRef.current)
    ballsRef.current = [
      {
        x: W / 2 - 40, y: H / 2,
        vx: -3.2 * lm, vy: (Math.random() - 0.5) * 3 * lm,
        stuck: false, stuckOffset: 0,
      },
    ]
  }, [])

  // Wipe power-ups (called on death and new game).
  const clearEffects = useCallback(() => {
    effectsRef.current = { wide: 0, sticky: 0 }
    capsulesRef.current = []
    setEffects({ wide: 0, sticky: 0 })
  }, [])

  const startGame = useCallback(() => {
    setLevel(1)
    levelRef.current = 1
    bricksRef.current = buildBricks(1)
    clearEffects()
    resetBallAndBat()
    setScore(0)
    setLives(3)
    setStatus("playing")
  }, [resetBallAndBat, clearEffects])

  // Advance to the next level: keep score + lives, rebuild a harder grid,
  // bump baseline ball speed, return to "playing".
  const advanceLevel = useCallback(() => {
    setLevel((l) => {
      const next = l + 1
      levelRef.current = next
      bricksRef.current = buildBricks(next)
      resetBallAndBat()
      setStatus("playing")
      return next
    })
  }, [resetBallAndBat])

  // Auto-advance ~1.5s after clearing a level
  useEffect(() => {
    if (status !== "cleared") return
    const t = window.setTimeout(() => advanceLevel(), 1500)
    return () => window.clearTimeout(t)
  }, [status, advanceLevel])

  // While playing, tick the UI clock every 200ms so timer bars refresh,
  // and sync expired effects to state.
  useEffect(() => {
    if (status !== "playing") return
    const id = window.setInterval(() => {
      const now = performance.now()
      const before = effectsRef.current
      const after = {
        wide: before.wide > now ? before.wide : 0,
        sticky: before.sticky > now ? before.sticky : 0,
      }
      if (after.wide !== before.wide || after.sticky !== before.sticky) {
        effectsRef.current = after
      }
      setEffects({ ...effectsRef.current })
      setUiClock((c) => c + 1)
    }, 200)
    return () => window.clearInterval(id)
  }, [status])

  /* ----- Main game loop (rAF) ----- */

  useEffect(() => {
    let raf = 0
    let last = performance.now()

    const step = (now: number) => {
      const dt = Math.min(48, now - last) / 16.6667 // frames at 60fps
      last = now

      if (statusRef.current === "playing") {
        const mult = SPEEDS[speedRef.current].mult
        const nowMs = now
        const batH = effectsRef.current.wide > nowMs ? BAT_H * 1.6 : BAT_H
        const sticky = effectsRef.current.sticky > nowMs
        // (Effect expiry sync to React state is handled by the 200ms interval.)

        // bat
        batYRef.current += batVRef.current * 6 * mult * dt
        if (batYRef.current < 4) batYRef.current = 4
        if (batYRef.current > H - 4 - batH) batYRef.current = H - 4 - batH

        // -------- Balls --------
        const survivingBalls: Ball[] = []
        let totalHitBrick = false
        for (const ball of ballsRef.current) {
          if (ball.stuck) {
            // Glue to bat: ride along with it.
            ball.y = batYRef.current + ball.stuckOffset
            ball.x = BAT_X - BALL_R
            survivingBalls.push(ball)
            continue
          }

          ball.x += ball.vx * mult * dt
          ball.y += ball.vy * mult * dt

          // top/bottom walls
          if (ball.y - BALL_R < 2) { ball.y = 2 + BALL_R; ball.vy *= -1 }
          if (ball.y + BALL_R > H - 2) { ball.y = H - 2 - BALL_R; ball.vy *= -1 }
          // left wall
          if (ball.x - BALL_R < 2) { ball.x = 2 + BALL_R; ball.vx *= -1 }

          // bat collision (uses dynamic batH)
          if (
            ball.x + BALL_R >= BAT_X &&
            ball.x - BALL_R <= BAT_X + BAT_W &&
            ball.y >= batYRef.current &&
            ball.y <= batYRef.current + batH &&
            ball.vx > 0
          ) {
            ball.x = BAT_X - BALL_R
            const hit = (ball.y - (batYRef.current + batH / 2)) / (batH / 2)
            if (sticky) {
              // Catch the ball; release on OK.
              ball.stuck = true
              ball.stuckOffset = ball.y - batYRef.current
              ball.vx = 0
              ball.vy = 0
            } else {
              ball.vx *= -1
              ball.vy = hit * 4
              ball.vx *= 1.02 // small speed boost per hit
            }
          }

          // miss → drop this ball (life loss happens after the loop if no balls remain)
          if (ball.x - BALL_R > W) continue

          // brick collision (per ball)
          for (const b of bricksRef.current) {
            if (!b.alive) continue
            if (
              ball.x + BALL_R > b.x &&
              ball.x - BALL_R < b.x + BRICK_W &&
              ball.y + BALL_R > b.y &&
              ball.y - BALL_R < b.y + BRICK_H
            ) {
              const styleBefore = BRICK_STYLES[b.hits] ?? BRICK_STYLES[1]
              b.hits -= 1
              const destroyed = b.hits <= 0
              if (destroyed) b.alive = false
              totalHitBrick = true
              const overlapX = Math.min(ball.x + BALL_R - b.x, b.x + BRICK_W - (ball.x - BALL_R))
              const overlapY = Math.min(ball.y + BALL_R - b.y, b.y + BRICK_H - (ball.y - BALL_R))
              if (overlapX < overlapY) ball.vx *= -1
              else ball.vy *= -1
              setScore((s) => {
                const next = s + styleBefore.score
                setHighScore((h) => (next > h ? next : h))
                return next
              })
              // Capsule drop on destruction
              if (destroyed && Math.random() < POWER_DROP_CHANCE) {
                const kinds: PowerKind[] = ["multi", "wide", "sticky"]
                const kind = kinds[Math.floor(Math.random() * kinds.length)]
                capsulesRef.current.push({
                  x: b.x + BRICK_W / 2,
                  y: b.y + BRICK_H / 2,
                  // Drift rightward (toward bat) with a little downward fall.
                  vx: 2.2, vy: 0.6,
                  kind,
                })
              }
              break
            }
          }

          survivingBalls.push(ball)
        }
        ballsRef.current = survivingBalls

        // No balls left → lose a life
        if (ballsRef.current.length === 0) {
          setLives((l) => {
            const next = l - 1
            if (next <= 0) {
              setStatus("over")
            } else {
              resetBallAndBat()
            }
            return next
          })
        }

        // -------- Capsules --------
        const survivingCaps: Capsule[] = []
        for (const cap of capsulesRef.current) {
          cap.x += cap.vx * mult * dt
          cap.y += cap.vy * mult * dt
          // bat catch
          if (
            cap.x + 10 >= BAT_X &&
            cap.x - 10 <= BAT_X + BAT_W &&
            cap.y >= batYRef.current &&
            cap.y <= batYRef.current + batH
          ) {
            activatePower(cap.kind)
            setScore((s) => s + 50) // catching a capsule also awards points
            continue
          }
          // off-screen
          if (cap.x > W + 20 || cap.y > H + 20) continue
          survivingCaps.push(cap)
        }
        capsulesRef.current = survivingCaps

        if (totalHitBrick && bricksRef.current.every((b) => !b.alive)) {
          setStatus("cleared")
        }
      }

      draw()
      raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [draw, resetBallAndBat])

  /* ----- Input ----- */

  const setBatDir = useCallback((dir: -1 | 0 | 1) => {
    batVRef.current = dir
  }, [])

  // Release any stuck balls (Sticky bat). Returns true if anything was released.
  const releaseStuckBalls = useCallback(() => {
    let released = false
    const lm = levelMult(levelRef.current)
    for (const b of ballsRef.current) {
      if (b.stuck) {
        b.stuck = false
        // Launch leftward with a slight angle based on stick position.
        const hit = (b.stuckOffset - currentBatH() / 2) / (currentBatH() / 2)
        b.vx = -3.2 * lm
        b.vy = hit * 4
        released = true
      }
    }
    return released
  }, [])

  // Bat is a "hold" control: track which vertical directions are held so that
  // pressing up while down is still held resolves correctly.
  const heldRef = useRef<Set<Dir4>>(new Set())
  const syncBat = useCallback(() => {
    const up = heldRef.current.has("up")
    const dn = heldRef.current.has("down")
    setBatDir(up && !dn ? -1 : dn && !up ? 1 : 0)
  }, [setBatDir])
  const handlePress = useCallback((dir: Dir4) => {
    heldRef.current.add(dir)
    syncBat()
  }, [syncBat])
  const handleRelease = useCallback((dir: Dir4) => {
    heldRef.current.delete(dir)
    syncBat()
  }, [syncBat])

  // OK / Enter / Space: release a stuck ball, else pause/resume/advance/start.
  const handleOk = useCallback(() => {
    const s = statusRef.current
    if (s === "playing") {
      if (!releaseStuckBalls()) setStatus("paused")
    } else if (s === "paused") {
      setStatus("playing")
    } else if (s === "cleared") {
      advanceLevel() // skip the 1.5s wait
    } else {
      startGame()
    }
  }, [releaseStuckBalls, advanceLevel, startGame])

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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Krakout</h1>
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Level <span className="text-primary">{level}</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Lives</span>
            <span className="font-mono text-2xl font-bold text-destructive tabular-nums">{"♥".repeat(Math.max(0, lives))}</span>
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
            // Don't steal focus from the controller when clicked — keeps
            // the TV remote / arrow keys driving the bat after a tap.
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

      {/* Active power-ups */}
      <div className="flex h-7 w-full max-w-md items-center justify-center gap-2">
        {(["wide", "sticky"] as const).map((k) => {
          const until = effects[k]
          if (!until || until <= performance.now()) return null
          const remaining = Math.max(0, until - performance.now())
          const pct = Math.min(100, (remaining / POWER_DURATION_MS) * 100)
          return (
            <div key={k} className="flex items-center gap-2 rounded-md border border-border bg-card/60 px-2 py-1">
              <span
                className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-black"
                style={{ background: POWER_COLORS[k] }}
              >
                {POWER_GLYPHS[k]}
              </span>
              <span className="text-[11px] font-medium text-foreground">{POWER_LABELS[k]}</span>
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-background/60">
                <div
                  className="h-full transition-[width] duration-200"
                  style={{ width: `${pct}%`, background: POWER_COLORS[k] }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Board */}
      <div className="relative rounded-xl border border-border bg-card p-2 shadow-lg">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="block max-w-full rounded-lg"
          style={{ width: W, maxWidth: "100%", aspectRatio: `${W} / ${H}`, height: "auto" }}
          aria-label="Krakout game board"
        />

        {status !== "playing" && (
          <div
            className={`absolute inset-2 flex flex-col items-center justify-center gap-3 rounded-lg ${
              status === "over" || status === "cleared"
                ? "bg-card/40 backdrop-blur-[2px]"
                : "bg-card/85 backdrop-blur-sm"
            }`}
          >
            {status === "over" && (
              <div className="text-center">
                <p className="text-2xl font-bold text-destructive">Game Over</p>
                <p className="text-sm text-muted-foreground">Final score: {score}</p>
              </div>
            )}
            {status === "cleared" && (
              <div className="text-center">
                <p className="text-2xl font-bold text-primary">Level {level} Cleared!</p>
                <p className="text-sm text-muted-foreground">Score: {score}</p>
                <p className="mt-1 text-xs text-muted-foreground">Loading level {level + 1}…</p>
              </div>
            )}
            {status === "paused" && (
              <p className="text-xl font-bold text-foreground">Paused</p>
            )}
            {status === "idle" && (
              <p className="px-6 text-center text-sm text-muted-foreground text-pretty">
                Bat on the right — move it up & down to keep the ball alive and smash all the bricks.
              </p>
            )}
            {status !== "cleared" && (
              <p className="text-xs text-muted-foreground">
                Click the Controller below to {status === "idle" ? "start" : status === "paused" ? "resume" : "play again"}.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Shared controller — vertical bat (hold) + OK to release sticky. */}
      <GameController
        axes="vertical"
        mode="hold"
        status={status}
        widthClass="max-w-md"
        onPress={handlePress}
        onRelease={handleRelease}
        onOk={handleOk}
        labels={{ active: "Controller active — up / down" }}
        hint={{ active: "ring up/down · arrows · WS · OK to release sticky" }}
      />

      {/* Power-up legend */}
      <div className="flex w-full max-w-md flex-wrap items-center justify-center gap-3 text-[11px] text-muted-foreground">
        <span className="uppercase tracking-widest">Capsules:</span>
        {(["multi", "wide", "sticky"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span
              className="flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold text-black"
              style={{ background: POWER_COLORS[k] }}
            >
              {POWER_GLYPHS[k]}
            </span>
            <span>{POWER_LABELS[k]}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
