"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { GameController, type Dir4 } from "@/components/game-controller"

/* ------------------------------ Constants ------------------------------ */

const W = 520
const H = 440

const SHIP_W = 34
const SHIP_H = 18
const SHIP_Y = H - 34
const SHIP_SPEED = 5 // px per frame @60fps

// Alien formation
const ROWS = 4
const COLS = 8
const ALIEN_W = 26
const ALIEN_H = 18
const GAP_X = 12
const GAP_Y = 14
const FORM_OX = 40 // formation left margin (origin)
const FORM_OY = 50 // formation top margin (origin)
const STEP_X = ALIEN_W + GAP_X
const STEP_Y = ALIEN_H + GAP_Y
const FORM_DESCEND = 16 // px the formation drops on edge bounce

// Combat
const BULLET_SPEED = 8
const BOMB_SPEED = 3.2
const FIRE_COOLDOWN_MS = 320
const MAX_PLAYER_BULLETS = 3
const INVULN_MS = 1500

type Status = "idle" | "playing" | "over" | "cleared"
type Alien = {
  col: number
  row: number
  alive: boolean
  diving: boolean
  x: number
  y: number
  vx: number
  vy: number
  t: number // path parameter while diving
}
type Bullet = { x: number; y: number }
type Bomb = { x: number; y: number; vx: number; vy: number }

type SpeedKey = "chill" | "normal" | "fast" | "insane"
const SPEEDS: Record<SpeedKey, { label: string; mult: number }> = {
  chill: { label: "Chill", mult: 0.7 },
  normal: { label: "Normal", mult: 1.0 },
  fast: { label: "Fast", mult: 1.4 },
  insane: { label: "Insane", mult: 1.9 },
}

// Score per row — back rows (lower row index) are worth more.
const ROW_SCORE = [60, 40, 25, 15]

// Alien colors by row.
const ALIEN_FILL = ["#f472b6", "#a855f7", "#3b82f6", "#22d3ee"]

/* ----- C1. buildFormation (pure) ----- */

function buildFormation(): Alien[] {
  const out: Alien[] = []
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      out.push({
        col: c,
        row: r,
        alive: true,
        diving: false,
        x: FORM_OX + c * STEP_X,
        y: FORM_OY + r * STEP_Y,
        vx: 0,
        vy: 0,
        t: 0,
      })
    }
  }
  return out
}

// Home position of an alien for the current formation origin.
const homeX = (ox: number, col: number) => ox + col * STEP_X
const homeY = (oy: number, row: number) => oy + row * STEP_Y

/* ------------------------------- Component ------------------------------ */

export function GalaxyGame() {
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
  const shipXRef = useRef<number>(W / 2 - SHIP_W / 2)
  const moveDirRef = useRef<-1 | 0 | 1>(0)
  const heldRef = useRef<Set<Dir4>>(new Set())
  const aliensRef = useRef<Alien[]>(buildFormation())
  const bulletsRef = useRef<Bullet[]>([])
  const bombsRef = useRef<Bomb[]>([])
  const lastFireRef = useRef<number>(0)
  const formationRef = useRef<{ ox: number; oy: number; dir: 1 | -1 }>({ ox: FORM_OX, oy: FORM_OY, dir: 1 })
  const invulnUntilRef = useRef<number>(0)

  useEffect(() => { statusRef.current = status }, [status])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { levelRef.current = level }, [level])

  // Difficulty scaling per wave.
  const formationSpeed = (lvl: number) => 0.6 + (lvl - 1) * 0.18
  const diveChance = (lvl: number) => 0.004 + (lvl - 1) * 0.0018 // per frame, per call
  const bombChance = (lvl: number) => 0.006 + (lvl - 1) * 0.002

  /* ----- C2. draw ----- */

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const styles = getComputedStyle(document.documentElement)
    const bg = styles.getPropertyValue("--card").trim() || "#0b0f1a"
    const border = styles.getPropertyValue("--border").trim() || "#333"

    // background
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // starfield (deterministic so it doesn't shimmer)
    ctx.fillStyle = "rgba(255,255,255,0.5)"
    for (let i = 0; i < 60; i++) {
      const sx = (i * 73) % W
      const sy = (i * 137 + (Date.now() / 40)) % H
      const s = (i % 3) === 0 ? 1.6 : 1
      ctx.globalAlpha = 0.15 + (i % 5) * 0.12
      ctx.fillRect(sx, sy, s, s)
    }
    ctx.globalAlpha = 1

    // border
    ctx.strokeStyle = border
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, W - 2, H - 2)

    // aliens
    for (const a of aliensRef.current) {
      if (!a.alive) continue
      const fill = ALIEN_FILL[a.row] ?? ALIEN_FILL[ALIEN_FILL.length - 1]
      ctx.fillStyle = fill
      // body
      ctx.beginPath()
      ctx.roundRect(a.x, a.y, ALIEN_W, ALIEN_H, 5)
      ctx.fill()
      // eyes
      ctx.fillStyle = "rgba(0,0,0,0.75)"
      ctx.fillRect(a.x + 6, a.y + 6, 4, 4)
      ctx.fillRect(a.x + ALIEN_W - 10, a.y + 6, 4, 4)
      // little "legs"
      ctx.fillStyle = fill
      ctx.fillRect(a.x + 3, a.y + ALIEN_H, 3, 3)
      ctx.fillRect(a.x + ALIEN_W - 6, a.y + ALIEN_H, 3, 3)
    }

    // bombs (enemy)
    ctx.fillStyle = "#fca5a5"
    for (const b of bombsRef.current) {
      ctx.beginPath()
      ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2)
      ctx.fill()
    }

    // player bullets
    ctx.fillStyle = "#fde047"
    for (const bl of bulletsRef.current) {
      ctx.fillRect(bl.x - 1.5, bl.y - 8, 3, 10)
    }

    // ship
    const now = performance.now()
    const invuln = invulnUntilRef.current > now
    const sx = shipXRef.current
    if (!invuln || Math.floor(now / 120) % 2 === 0) {
      const grad = ctx.createLinearGradient(0, SHIP_Y, 0, SHIP_Y + SHIP_H)
      grad.addColorStop(0, "#86efac")
      grad.addColorStop(1, "#16a34a")
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.moveTo(sx + SHIP_W / 2, SHIP_Y) // nose
      ctx.lineTo(sx, SHIP_Y + SHIP_H)
      ctx.lineTo(sx + SHIP_W, SHIP_Y + SHIP_H)
      ctx.closePath()
      ctx.fill()
      // cockpit
      ctx.fillStyle = "rgba(255,255,255,0.6)"
      ctx.beginPath()
      ctx.arc(sx + SHIP_W / 2, SHIP_Y + SHIP_H - 6, 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [])

  /* ----- C3. lifecycle: reset / start / advance ----- */

  const resetShipAndClearShots = useCallback(() => {
    shipXRef.current = W / 2 - SHIP_W / 2
    moveDirRef.current = 0
    heldRef.current.clear()
    bulletsRef.current = []
    bombsRef.current = []
  }, [])

  const loadWave = useCallback(() => {
    aliensRef.current = buildFormation()
    formationRef.current = { ox: FORM_OX, oy: FORM_OY, dir: 1 }
  }, [])

  const startGame = useCallback(() => {
    setLevel(1)
    levelRef.current = 1
    loadWave()
    resetShipAndClearShots()
    invulnUntilRef.current = performance.now() + INVULN_MS
    setScore(0)
    setLives(3)
    setStatus("playing")
  }, [loadWave, resetShipAndClearShots])

  const advanceWave = useCallback(() => {
    setLevel((l) => {
      const next = l + 1
      levelRef.current = next
      loadWave()
      resetShipAndClearShots()
      invulnUntilRef.current = performance.now() + INVULN_MS
      setStatus("playing")
      return next
    })
  }, [loadWave, resetShipAndClearShots])

  /* ----- C6. auto-advance after a cleared wave ----- */
  useEffect(() => {
    if (status !== "cleared") return
    const t = window.setTimeout(() => advanceWave(), 1200)
    return () => window.clearTimeout(t)
  }, [status, advanceWave])

  /* ----- C4. fire ----- */

  const fireBullet = useCallback(() => {
    const now = performance.now()
    if (now - lastFireRef.current < FIRE_COOLDOWN_MS) return
    if (bulletsRef.current.length >= MAX_PLAYER_BULLETS) return
    lastFireRef.current = now
    bulletsRef.current.push({ x: shipXRef.current + SHIP_W / 2, y: SHIP_Y - 2 })
  }, [])

  /* ----- C5. main game loop (rAF) ----- */

  useEffect(() => {
    let raf = 0
    let last = performance.now()

    const step = (now: number) => {
      const dt = Math.min(48, now - last) / 16.6667
      last = now

      if (statusRef.current === "playing") {
        const mult = SPEEDS[speedRef.current].mult
        const lvl = levelRef.current
        const aliens = aliensRef.current
        const form = formationRef.current

        // ship
        shipXRef.current += moveDirRef.current * SHIP_SPEED * mult * dt
        if (shipXRef.current < 4) shipXRef.current = 4
        if (shipXRef.current > W - 4 - SHIP_W) shipXRef.current = W - 4 - SHIP_W

        // formation drift — find horizontal bounds of living, non-diving aliens
        let minX = Infinity
        let maxX = -Infinity
        for (const a of aliens) {
          if (!a.alive || a.diving) continue
          if (a.x < minX) minX = a.x
          if (a.x + ALIEN_W > maxX) maxX = a.x + ALIEN_W
        }
        if (minX !== Infinity) {
          const fdx = formationSpeed(lvl) * form.dir * mult * dt
          form.ox += fdx
          // bounce + descend
          if (maxX + fdx > W - 6 && form.dir === 1) {
            form.dir = -1
            form.oy += FORM_DESCEND
          } else if (minX + fdx < 6 && form.dir === -1) {
            form.dir = 1
            form.oy += FORM_DESCEND
          }
        }

        // position formation aliens; integrate divers
        for (const a of aliens) {
          if (!a.alive) continue
          if (a.diving) {
            a.t += 0.02 * mult * dt
            a.y += a.vy * mult * dt
            a.x += Math.sin(a.t * Math.PI * 2) * 2.4 * mult * dt + a.vx * mult * dt
            // off the bottom → return to formation slot
            if (a.y > H + 10) {
              a.diving = false
              a.y = -ALIEN_H
            }
          } else {
            // ease back toward home (covers post-dive return + normal drift)
            const hx = homeX(form.ox, a.col)
            const hy = homeY(form.oy, a.row)
            a.x += (hx - a.x) * Math.min(1, 0.25 * dt)
            a.y += (hy - a.y) * Math.min(1, 0.25 * dt)
          }
        }

        // start a new diver occasionally
        if (Math.random() < diveChance(lvl) * dt) {
          const candidates = aliens.filter((a) => a.alive && !a.diving)
          if (candidates.length) {
            const d = candidates[Math.floor(Math.random() * candidates.length)]
            d.diving = true
            d.t = 0
            d.vy = 2.4 + lvl * 0.15
            d.vx = (shipXRef.current - d.x) > 0 ? 1.1 : -1.1
          }
        }

        // aliens drop bombs (divers + front-most alive in a column)
        for (const a of aliens) {
          if (!a.alive) continue
          const eligible = a.diving || a.row === ROWS - 1
          if (eligible && Math.random() < bombChance(lvl) * 0.25 * dt) {
            bombsRef.current.push({ x: a.x + ALIEN_W / 2, y: a.y + ALIEN_H, vx: 0, vy: BOMB_SPEED })
          }
        }

        // move bullets up
        const liveBullets: Bullet[] = []
        for (const bl of bulletsRef.current) {
          bl.y -= BULLET_SPEED * mult * dt
          if (bl.y < -12) continue
          liveBullets.push(bl)
        }
        bulletsRef.current = liveBullets

        // move bombs down
        const liveBombs: Bomb[] = []
        for (const bm of bombsRef.current) {
          bm.y += bm.vy * mult * dt
          if (bm.y > H + 12) continue
          liveBombs.push(bm)
        }
        bombsRef.current = liveBombs

        // bullet × alien collisions
        for (const bl of bulletsRef.current) {
          for (const a of aliens) {
            if (!a.alive) continue
            if (bl.x > a.x && bl.x < a.x + ALIEN_W && bl.y > a.y && bl.y < a.y + ALIEN_H) {
              a.alive = false
              bl.y = -999 // mark for cull next frame
              const gained = ROW_SCORE[a.row] ?? 10
              setScore((s) => {
                const nx = s + gained
                setHighScore((h) => (nx > h ? nx : h))
                return nx
              })
              break
            }
          }
        }
        bulletsRef.current = bulletsRef.current.filter((bl) => bl.y > -100)

        // ship hit? (bombs or diving aliens)
        const nowMs = now
        const invuln = invulnUntilRef.current > nowMs
        const shipBox = { x: shipXRef.current, y: SHIP_Y, w: SHIP_W, h: SHIP_H }
        let hit = false
        if (!invuln) {
          for (const bm of bombsRef.current) {
            if (bm.x > shipBox.x && bm.x < shipBox.x + shipBox.w && bm.y > shipBox.y && bm.y < shipBox.y + shipBox.h) {
              hit = true
              break
            }
          }
          if (!hit) {
            for (const a of aliens) {
              if (!a.alive || !a.diving) continue
              if (a.x + ALIEN_W > shipBox.x && a.x < shipBox.x + shipBox.w && a.y + ALIEN_H > shipBox.y && a.y < shipBox.y + shipBox.h) {
                hit = true
                a.alive = false
                break
              }
            }
          }
        }
        if (hit) {
          bombsRef.current = []
          invulnUntilRef.current = nowMs + INVULN_MS
          setLives((l) => {
            const next = l - 1
            if (next <= 0) setStatus("over")
            else resetShipAndClearShots()
            return next
          })
        }

        // wave cleared?
        if (aliens.every((a) => !a.alive)) {
          setStatus("cleared")
        }
      }

      draw()
      raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [draw, resetShipAndClearShots])

  /* ----- D. input handlers ----- */

  const syncMove = useCallback(() => {
    const left = heldRef.current.has("left")
    const right = heldRef.current.has("right")
    moveDirRef.current = left && !right ? -1 : right && !left ? 1 : 0
  }, [])
  const handlePress = useCallback((dir: Dir4) => {
    heldRef.current.add(dir)
    syncMove()
  }, [syncMove])
  const handleRelease = useCallback((dir: Dir4) => {
    heldRef.current.delete(dir)
    syncMove()
  }, [syncMove])
  const handleOk = useCallback(() => {
    if (statusRef.current === "playing") fireBullet()
    else if (statusRef.current !== "cleared") startGame()
  }, [fireBullet, startGame])

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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Galaxy</h1>
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Wave <span className="text-primary">{level}</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Lives</span>
            <span className="font-mono text-2xl font-bold text-destructive tabular-nums">{"▲".repeat(Math.max(0, lives))}</span>
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

      {/* Board */}
      <div className="relative rounded-xl border border-border bg-card p-2 shadow-lg">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="block max-w-full rounded-lg"
          style={{ width: W, maxWidth: "100%", aspectRatio: `${W} / ${H}`, height: "auto" }}
          aria-label="Galaxy game board"
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
                <p className="text-2xl font-bold text-primary">Wave {level} Cleared!</p>
                <p className="text-sm text-muted-foreground">Score: {score}</p>
                <p className="mt-1 text-xs text-muted-foreground">Incoming wave {level + 1}…</p>
              </div>
            )}
            {status === "idle" && (
              <p className="px-6 text-center text-sm text-muted-foreground text-pretty">
                Defend the galaxy — move left & right and fire to clear the fleet before it lands.
              </p>
            )}
            {status !== "cleared" && (
              <p className="text-xs text-muted-foreground">
                Click the Controller below to {status === "idle" ? "start" : "play again"}.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Shared controller — horizontal ship (hold) + OK to fire. */}
      <GameController
        axes="horizontal"
        mode="hold"
        status={status}
        widthClass="max-w-md"
        onPress={handlePress}
        onRelease={handleRelease}
        onOk={handleOk}
        labels={{ active: "Controller active — move & OK to fire" }}
        hint={{ active: "ring left/right · arrows · AD · OK to fire" }}
      />
    </div>
  )
}
