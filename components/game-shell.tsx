"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SnakeGame } from "@/components/snake-game"
import { KrakoutGame } from "@/components/krakout-game"
import { GalaxyGame } from "@/components/galaxy-game"
import { YouTubePanel } from "@/components/youtube-panel"

export function GameShell() {
  return (
    <Tabs defaultValue="snake" className="flex w-full max-w-2xl flex-col items-center gap-6">
      <TabsList className="w-full max-w-md">
        <TabsTrigger value="snake" className="flex-1">
          Snake
        </TabsTrigger>
        <TabsTrigger value="krakout" className="flex-1">
          Krakout
        </TabsTrigger>
        <TabsTrigger value="galaxy" className="flex-1">
          Galaxy
        </TabsTrigger>
        <TabsTrigger value="youtube" className="flex-1">
          YouTube
        </TabsTrigger>
      </TabsList>

      <TabsContent value="snake" className="flex w-full justify-center focus-visible:outline-none">
        <SnakeGame />
      </TabsContent>

      <TabsContent value="krakout" className="flex w-full justify-center focus-visible:outline-none">
        <KrakoutGame />
      </TabsContent>

      <TabsContent value="galaxy" className="flex w-full justify-center focus-visible:outline-none">
        <GalaxyGame />
      </TabsContent>

      <TabsContent value="youtube" className="flex w-full justify-center focus-visible:outline-none">
        <YouTubePanel />
      </TabsContent>
    </Tabs>
  )
}
