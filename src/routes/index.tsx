import { createFileRoute } from "@tanstack/react-router";
import { Game } from "../game/Game";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Vice Heights: GTA-style city shooter by Tyler Szakacs" }],
  }),
  component: Game,
});
