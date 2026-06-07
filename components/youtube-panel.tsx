"use client"

import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
const SCOPE = "https://www.googleapis.com/auth/youtube.readonly"

/* ----------------------------- Google types ----------------------------- */

type TokenResponse = { access_token: string; expires_in: number; error?: string }
type TokenClient = { requestAccessToken: (opts?: { prompt?: string }) => void }

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (resp: TokenResponse) => void
            error_callback?: (err: { type?: string }) => void
          }) => TokenClient
          revoke: (token: string, done?: () => void) => void
        }
      }
    }
  }
}

/* ------------------------------- Data types ------------------------------ */

type Source =
  | { kind: "video"; id: string }
  | { kind: "playlist"; id: string }
  | null

type VideoItem = { id: string; title: string; thumbnail: string; channelTitle: string }
type PlaylistItem = { id: string; title: string; thumbnail: string; count: number }
type SubscriptionItem = { channelId: string; title: string; thumbnail: string; uploadsHint: string }

type Profile = {
  title: string
  thumbnail: string
  likesPlaylistId: string | null
}

type LibraryTab = "liked" | "playlists" | "subscriptions" | "search"

/* ------------------------------ URL parsing ------------------------------ */

function parseInput(raw: string): Source {
  const input = raw.trim()
  if (!input) return null
  if (/^(PL|UU|LL|FL|RD|OL)[A-Za-z0-9_-]{10,}$/.test(input)) return { kind: "playlist", id: input }
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return { kind: "video", id: input }
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`)
    const host = url.hostname.replace(/^www\./, "")
    const list = url.searchParams.get("list")
    if (list && (url.pathname.includes("playlist") || (!url.searchParams.get("v") && host.includes("youtube")))) {
      return { kind: "playlist", id: list }
    }
    if (host === "youtu.be") {
      const id = url.pathname.slice(1).split("/")[0]
      if (id) return { kind: "video", id }
    }
    const v = url.searchParams.get("v")
    if (v) return { kind: "video", id: v }
    const m = url.pathname.match(/\/(embed|shorts|live)\/([A-Za-z0-9_-]{11})/)
    if (m) return { kind: "video", id: m[2] }
    if (list) return { kind: "playlist", id: list }
  } catch {
    /* not a URL */
  }
  return null
}

function buildEmbedSrc(source: Source): string | null {
  if (!source) return null
  if (source.kind === "playlist") {
    return `https://www.youtube-nocookie.com/embed/videoseries?list=${source.id}&autoplay=1`
  }
  return `https://www.youtube-nocookie.com/embed/${source.id}?autoplay=1`
}

/* ------------------------------ API helpers ------------------------------ */

const API = "https://www.googleapis.com/youtube/v3"

async function api<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const msg = body?.error?.message || `Request failed (${res.status})`
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

/* -------------------------------- GIS load ------------------------------- */

function useGisLoaded() {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (window.google?.accounts?.oauth2) {
      setLoaded(true)
      return
    }
    const existing = document.getElementById("gis-script") as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener("load", () => setLoaded(true))
      return
    }
    const s = document.createElement("script")
    s.src = "https://accounts.google.com/gsi/client"
    s.async = true
    s.defer = true
    s.id = "gis-script"
    s.onload = () => setLoaded(true)
    document.head.appendChild(s)
  }, [])
  return loaded
}

/* ------------------------------- Component ------------------------------- */

export function YouTubePanel() {
  const [value, setValue] = useState("")
  const [source, setSource] = useState<Source>(null)
  const [error, setError] = useState<string | null>(null)

  const [token, setToken] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [authBusy, setAuthBusy] = useState(false)

  const [tab, setTab] = useState<LibraryTab>("liked")
  const [liked, setLiked] = useState<VideoItem[] | null>(null)
  const [playlists, setPlaylists] = useState<PlaylistItem[] | null>(null)
  const [subs, setSubs] = useState<SubscriptionItem[] | null>(null)
  const [listBusy, setListBusy] = useState(false)

  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<VideoItem[] | null>(null)

  const tokenClientRef = useRef<TokenClient | null>(null)
  const gisLoaded = useGisLoaded()

  const play = useCallback((raw: string) => {
    const parsed = parseInput(raw)
    if (!parsed) {
      setError("Couldn't find a YouTube video or playlist in that. Paste a link or video ID.")
      return
    }
    setError(null)
    setSource(parsed)
  }, [])

  /* ----- Auth ----- */

  const initClient = useCallback(() => {
    if (!CLIENT_ID || !window.google?.accounts?.oauth2) return null
    if (!tokenClientRef.current) {
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (resp) => {
          setAuthBusy(false)
          if (resp.error || !resp.access_token) {
            setError("Sign-in was cancelled or failed.")
            return
          }
          setError(null)
          setToken(resp.access_token)
        },
        error_callback: () => {
          setAuthBusy(false)
          setError("Sign-in was cancelled.")
        },
      })
    }
    return tokenClientRef.current
  }, [])

  const signIn = useCallback(() => {
    const client = initClient()
    if (!client) {
      setError("Google sign-in isn't ready yet. Try again in a moment.")
      return
    }
    setAuthBusy(true)
    client.requestAccessToken({ prompt: "consent" })
  }, [initClient])

  const signOut = useCallback(() => {
    if (token && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(token)
    }
    setToken(null)
    setProfile(null)
    setLiked(null)
    setPlaylists(null)
    setSubs(null)
    setSearchResults(null)
  }, [token])

  /* ----- Fetch profile once we have a token ----- */

  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<{
          items?: {
            snippet: { title: string; thumbnails: { default?: { url: string }; medium?: { url: string } } }
            contentDetails: { relatedPlaylists: { likes?: string } }
          }[]
        }>("channels?part=snippet,contentDetails&mine=true", token)
        if (cancelled) return
        const ch = data.items?.[0]
        if (ch) {
          setProfile({
            title: ch.snippet.title,
            thumbnail: ch.snippet.thumbnails.medium?.url || ch.snippet.thumbnails.default?.url || "",
            likesPlaylistId: ch.contentDetails.relatedPlaylists.likes || null,
          })
        } else {
          setProfile({ title: "Your account", thumbnail: "", likesPlaylistId: null })
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load your account.")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  /* ----- Lazy-load each library tab ----- */

  useEffect(() => {
    if (!token || !profile) return
    let cancelled = false

    async function loadLiked() {
      if (liked || !profile?.likesPlaylistId) return
      setListBusy(true)
      try {
        const data = await api<{
          items?: {
            snippet: {
              title: string
              videoOwnerChannelTitle?: string
              resourceId: { videoId: string }
              thumbnails: { medium?: { url: string }; default?: { url: string } }
            }
          }[]
        }>(`playlistItems?part=snippet&maxResults=25&playlistId=${profile.likesPlaylistId}`, token!)
        if (cancelled) return
        setLiked(
          (data.items || []).map((it) => ({
            id: it.snippet.resourceId.videoId,
            title: it.snippet.title,
            channelTitle: it.snippet.videoOwnerChannelTitle || "",
            thumbnail: it.snippet.thumbnails.medium?.url || it.snippet.thumbnails.default?.url || "",
          })),
        )
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load liked videos.")
      } finally {
        if (!cancelled) setListBusy(false)
      }
    }

    async function loadPlaylists() {
      if (playlists) return
      setListBusy(true)
      try {
        const data = await api<{
          items?: {
            id: string
            snippet: { title: string; thumbnails: { medium?: { url: string }; default?: { url: string } } }
            contentDetails: { itemCount: number }
          }[]
        }>("playlists?part=snippet,contentDetails&mine=true&maxResults=25", token!)
        if (cancelled) return
        setPlaylists(
          (data.items || []).map((it) => ({
            id: it.id,
            title: it.snippet.title,
            count: it.contentDetails.itemCount,
            thumbnail: it.snippet.thumbnails.medium?.url || it.snippet.thumbnails.default?.url || "",
          })),
        )
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load playlists.")
      } finally {
        if (!cancelled) setListBusy(false)
      }
    }

    async function loadSubs() {
      if (subs) return
      setListBusy(true)
      try {
        const data = await api<{
          items?: {
            snippet: {
              title: string
              resourceId: { channelId: string }
              thumbnails: { medium?: { url: string }; default?: { url: string } }
            }
          }[]
        }>("subscriptions?part=snippet&mine=true&maxResults=25&order=alphabetical", token!)
        if (cancelled) return
        setSubs(
          (data.items || []).map((it) => ({
            channelId: it.snippet.resourceId.channelId,
            title: it.snippet.title,
            uploadsHint: "",
            thumbnail: it.snippet.thumbnails.medium?.url || it.snippet.thumbnails.default?.url || "",
          })),
        )
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load subscriptions.")
      } finally {
        if (!cancelled) setListBusy(false)
      }
    }

    if (tab === "liked") loadLiked()
    else if (tab === "playlists") loadPlaylists()
    else if (tab === "subscriptions") loadSubs()

    return () => {
      cancelled = true
    }
  }, [tab, token, profile, liked, playlists, subs])

  const runSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!token || !searchQuery.trim()) return
      setListBusy(true)
      setError(null)
      try {
        const data = await api<{
          items?: {
            id: { videoId: string }
            snippet: {
              title: string
              channelTitle: string
              thumbnails: { medium?: { url: string }; default?: { url: string } }
            }
          }[]
        }>(`search?part=snippet&type=video&maxResults=20&q=${encodeURIComponent(searchQuery)}`, token)
        setSearchResults(
          (data.items || []).map((it) => ({
            id: it.id.videoId,
            title: it.snippet.title,
            channelTitle: it.snippet.channelTitle,
            thumbnail: it.snippet.thumbnails.medium?.url || it.snippet.thumbnails.default?.url || "",
          })),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed.")
      } finally {
        setListBusy(false)
      }
    },
    [token, searchQuery],
  )

  const embedSrc = buildEmbedSrc(source)
  const notConfigured = !CLIENT_ID

  /* -------------------------------- Render ------------------------------- */

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      {/* Account / sign-in card */}
      <CollapsiblePanel title="Account">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-pretty text-base font-bold text-foreground">YouTube library</h2>
            <p className="mt-1 text-pretty text-sm leading-relaxed text-muted-foreground">
              {token
                ? "Browse your liked videos, playlists, and subscriptions, then play them right here."
                : "Sign in with Google to see your liked videos, playlists, and subscriptions."}
            </p>
          </div>
          {profile?.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.thumbnail || "/placeholder.svg"}
              alt={profile.title}
              className="size-10 shrink-0 rounded-full border border-border object-cover"
            />
          ) : null}
        </div>

        {notConfigured ? (
          <p className="mt-3 rounded-lg border border-dashed border-border bg-background/50 p-3 text-sm text-muted-foreground text-pretty">
            Google sign-in isn&apos;t configured. Add a public{" "}
            <code className="text-foreground">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> to enable it.
          </p>
        ) : token ? (
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="truncate text-sm text-foreground">{profile?.title ?? "Signed in"}</span>
            <Button variant="secondary" size="sm" onClick={signOut} className="shrink-0">
              Sign out
            </Button>
          </div>
        ) : (
          <Button
            onClick={signIn}
            disabled={!gisLoaded || authBusy}
            className="mt-3 w-full"
          >
            {authBusy ? "Opening Google…" : gisLoaded ? "Sign in with Google" : "Loading…"}
          </Button>
        )}
      </CollapsiblePanel>

      {/* Player */}
      {embedSrc ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="aspect-video w-full">
            <iframe
              key={embedSrc}
              src={embedSrc}
              title="YouTube player"
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-6 text-center">
          <p className="text-sm text-muted-foreground text-pretty">
            Nothing playing yet — pick something from your library or paste a link below.
          </p>
        </div>
      )}

      {/* Library browser (signed in) */}
      {token && (
        <CollapsiblePanel title="Library">
          <div className="flex flex-wrap gap-1.5">
            {([
              ["liked", "Liked"],
              ["playlists", "Playlists"],
              ["subscriptions", "Subscriptions"],
              ["search", "Search"],
            ] as [LibraryTab, string][]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-3 max-h-72 overflow-y-auto">
            {tab === "search" && (
              <form onSubmit={runSearch} className="mb-3 flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search YouTube…"
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none ring-ring placeholder:text-muted-foreground focus-visible:ring-2"
                />
                <Button type="submit" size="sm" disabled={listBusy}>
                  Go
                </Button>
              </form>
            )}

            {listBusy && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}

            {!listBusy && tab === "liked" && (
              <VideoList items={liked} empty="No liked videos found." onPlay={(id) => setSource({ kind: "video", id })} />
            )}
            {!listBusy && tab === "search" && (
              <VideoList
                items={searchResults}
                empty="Search your YouTube for videos to play."
                onPlay={(id) => setSource({ kind: "video", id })}
              />
            )}
            {!listBusy && tab === "playlists" && (
              <ul className="flex flex-col gap-1">
                {(playlists ?? []).length === 0 && (
                  <li className="py-6 text-center text-sm text-muted-foreground">No playlists found.</li>
                )}
                {(playlists ?? []).map((pl) => (
                  <li key={pl.id}>
                    <button
                      type="button"
                      onClick={() => setSource({ kind: "playlist", id: pl.id })}
                      className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-secondary"
                    >
                      <img
                        src={pl.thumbnail || "/placeholder.svg?height=48&width=84&query=playlist"}
                        alt=""
                        className="h-12 w-20 shrink-0 rounded object-cover"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">{pl.title}</span>
                        <span className="block text-xs text-muted-foreground">{pl.count} videos</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!listBusy && tab === "subscriptions" && (
              <ul className="flex flex-col gap-1">
                {(subs ?? []).length === 0 && (
                  <li className="py-6 text-center text-sm text-muted-foreground">No subscriptions found.</li>
                )}
                {(subs ?? []).map((s) => (
                  <li key={s.channelId}>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery(s.title)
                        setTab("search")
                      }}
                      className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-secondary"
                    >
                      <img
                        src={s.thumbnail || "/placeholder.svg?height=40&width=40&query=channel"}
                        alt=""
                        className="size-10 shrink-0 rounded-full object-cover"
                      />
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">{s.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CollapsiblePanel>
      )}

      {/* Paste-a-link fallback (always available) */}
      <CollapsiblePanel title="Paste a link">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            play(value)
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <label htmlFor="yt-url" className="sr-only">
            YouTube link or video ID
          </label>
          <input
            id="yt-url"
            type="text"
            inputMode="url"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://youtu.be/… or video ID"
            className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none ring-ring placeholder:text-muted-foreground focus-visible:ring-2"
          />
          <Button type="submit" variant="secondary" className="shrink-0">
            Play
          </Button>
        </form>
      </CollapsiblePanel>

      {error && <p className="text-sm text-destructive text-pretty">{error}</p>}
    </div>
  )
}

function CollapsiblePanel({
  title,
  defaultOpen = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-border bg-card [&[open]>summary>svg]:rotate-90"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary/40 [&::-webkit-details-marker]:hidden">
        <span className="uppercase tracking-wide text-xs text-muted-foreground">{title}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted-foreground transition-transform"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </summary>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </details>
  )
}

/* ------------------------------ Sub-components ---------------------------- */

function VideoList({
  items,
  empty,
  onPlay,
}: {
  items: VideoItem[] | null
  empty: string
  onPlay: (id: string) => void
}) {
  if (!items || items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground text-pretty">{empty}</p>
  }
  return (
    <ul className="flex flex-col gap-1">
      {items.map((v) => (
        <li key={v.id}>
          <button
            type="button"
            onClick={() => onPlay(v.id)}
            className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-secondary"
          >
            <img
              src={v.thumbnail || "/placeholder.svg?height=48&width=84&query=video"}
              alt=""
              className="h-12 w-20 shrink-0 rounded object-cover"
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{v.title}</span>
              {v.channelTitle && (
                <span className="block truncate text-xs text-muted-foreground">{v.channelTitle}</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}