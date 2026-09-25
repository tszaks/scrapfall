import { createFileRoute } from "@tanstack/react-router";
import { Game } from "../game/Game";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Dustfield — Procedural FPS" },
      {
        name: "description",
        content:
          "A tiny first-person shooter with a procedurally generated arena. Move, look, shoot the drifters.",
      },
      { property: "og:title", content: "Dustfield — Procedural FPS" },
      {
        property: "og:description",
        content: "A tiny browser first-person shooter with a new procedural arena every round.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Game,
});
