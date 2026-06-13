"use client"

import { useEffect, useState } from "react"

/* ============================================================================
 * Platform detection — is the site running on a Samsung / Tizen TV?
 *
 * For a website loaded in the TV's *browser* (as opposed to a packaged Tizen
 * app), the `window.tizen` API is NOT exposed, so user-agent sniffing is the
 * only reliable signal. Samsung TV browsers carry tokens like:
 *
 *   Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like
 *   Gecko) 76.0.3809.146/6.0 TV Safari/537.36
 *
 * We also treat any obvious smart-TV / set-top UA as "TV" so the controller
 * affordances (remote hints, debug strip) can adapt on other living-room
 * browsers too.
 * ==========================================================================*/

export type TvKind = "samsung" | "other-tv" | null

/** Samsung Tizen specifically. */
const SAMSUNG_RE = /Tizen|SMART-TV.*Samsung|SamsungBrowser|Maple|SmartHub/i
/** Generic smart-TV / set-top / console UAs. */
const GENERIC_TV_RE = /SMART-TV|SmartTV|GoogleTV|Android\s?TV|AppleTV|Web0S|WebOS|HbbTV|NetCast|VIDAA|BRAVIA|CrKey|PlayStation|Xbox/i

export function detectTv(ua: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): TvKind {
  if (!ua) return null
  // A packaged Tizen app exposes window.tizen — strongest signal when present.
  if (typeof window !== "undefined" && (window as unknown as { tizen?: unknown }).tizen) {
    return "samsung"
  }
  if (SAMSUNG_RE.test(ua)) return "samsung"
  if (GENERIC_TV_RE.test(ua)) return "other-tv"
  return null
}

export const isSamsungTV = (ua?: string) => detectTv(ua) === "samsung"
export const isTV = (ua?: string) => detectTv(ua) !== null

/**
 * Hook form. Returns null on the server and first client render (so SSR markup
 * matches), then resolves to the detected platform after mount.
 */
export function useTvPlatform(): { kind: TvKind; isTV: boolean; isSamsung: boolean } {
  const [kind, setKind] = useState<TvKind>(null)
  useEffect(() => {
    setKind(detectTv())
  }, [])
  return { kind, isTV: kind !== null, isSamsung: kind === "samsung" }
}
