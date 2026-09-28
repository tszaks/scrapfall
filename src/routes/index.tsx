import { createFileRoute } from "@tanstack/react-router";
import { Game } from "../game/Game";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Scrapfall · Vice Heights by Tyler Szakacs" }],
  }),
  component: Game,
});
