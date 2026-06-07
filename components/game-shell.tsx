"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SnakeGame } from "@/components/snake-game"
import { YouTubePanel } from "@/components/youtube-panel"

export function GameShell() {
  return (
    <Tabs defaultValue="game" className="flex w-full max-w-md flex-col items-center gap-6">
      <TabsList className="w-full max-w-xs">
        <TabsTrigger value="game" className="flex-1">
          Game
        </TabsTrigger>
        <TabsTrigger value="youtube" className="flex-1">
          YouTube
        </TabsTrigger>
      </TabsList>

      <TabsContent value="game" className="flex w-full justify-center focus-visible:outline-none">
        <SnakeGame />
      </TabsContent>

      <TabsContent value="youtube" className="flex w-full justify-center focus-visible:outline-none">
        <YouTubePanel />
      </TabsContent>
    </Tabs>
  )
}