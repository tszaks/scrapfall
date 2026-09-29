# Roadmap

- [x] New percentage perk cards (crit, combustion 10%, knockback, ammo, armor, thorns, ricochet, leech)
- [x] Pistol mod cards (burst, incendiary, magnum)
- [x] Deployable crate drops (sentry turret ~1.5 waves, overshield, cryo mine, ammo cache)
- [x] Shop: cards may repeat, but never two rounds in a row
- [x] HUD status panel under KILLS: pistol mods, deployed crate effects, perk stacks
- [x] Distinct sentry turret firing sound; clear deployables on new arena
- [x] Main menu: drop the "Survive 12 waves… / Die and you lose…" line
- [x] Rename the play button to START
- [x] Move ability selection to a screen shown after pressing START
- [x] Co-op: show every player, their colour, and the ability they picked
- [x] 6 new guns (Hand Cannon, Shredder, Crossbow, Plasma Fan, Void Orb, Shattergun)
- [x] Health cards: Blood Siphon (+3% life steal), Field Medic (+3 heal after each wave)
- [x] Swap 4 abilities for Gravity Well, Chain Storm, Time Warp, Orbital Strike
- [x] Music must start reliably on the published site (audio unlock on first gesture)
- [x] Player bullets: bullet-shaped mesh aligned to flight direction, same colors
- [x] Visible effects for every ability (storm lightning arcs, orbital beam + ground marker, etc.)
- [x] Burning enemies show flames only while the burn lasts
- [x] Rework "happy" biome music into battle-intensity versions, keeping each theme
- [x] Mobile: remove weapon arrow buttons (tap the weapon chips instead)
- [x] Mobile: remove duplicate square ability badge in bottom corner
- [x] Mobile: pause button must not overlap other HUD blocks
- [x] Pause screen scrolls up and down on small screens
- [x] Mobile: cleaner round buttons, pause always on top (works during shop), co-op teammate list under shards
- [x] Mobile: full screen on START, page locked (no scroll/zoom/bounce)

- [x] Enemies never spawn inside rocks/props; knockback and Gravity Well stop at cover; stuck enemies get pushed out
- [x] Pause icon is two clean bars, moved to the top-left corner on mobile
- [x] Smaller weapon chips on mobile
- [x] Version 1.0.1
- [x] Bigger waves (1.25x on wave 1, +0.10x each wave), shuffled spawn order, tougher boss round
- [x] Version 1.0.2
- [x] Fix forest/map object loading (tree geometry, themed decor, tighter collision)
- [x] Themed interactive map hazards (shootable, per-theme effect, co-op synced)
- [x] Endless mode past wave 12 with wave mutators + high-wave record
- [x] Version 1.0.4

- [x] v1.0.4: fixed map scenery (tiered trees, biome decor, tighter collision)
- [x] v1.0.4: themed destructible hazards per map, co-op synced
- [x] v1.0.4: endless overtime past wave 12 with mutators + best-wave record

## Merge from tszaks/scrapfall (keep all our systems)
- [x] Controls: Space jump, Shift run, Enter shoot; mobile JUMP + RUN buttons; no gun sway
- [x] Bullet detail: brass band + glowing tracer
- [x] Bullets fire from the gun muzzle and converge on the crosshair
- [x] New robot enemy looks for the 7 regular enemies + Brass Automaton / Null Apex bosses + Scrap Leaper; others keep old look

- [x] Big maps copied EXACTLY from tszaks/scrapfall (src/bro, unchanged): Whiteout Pass, Pacific Pier, Vice Heights, Dry Gulch, Nuketown; co-op picker + radar
- [x] Map events + rolled conditions
- [x] New home menu (cycling map showcase, 8s crossfade) + pause menu with our stat sheet
- [x] Detail pass on our 10 maps (painted ground, ground cover, skyline beyond walls)

## Big-map exactness gaps (vs szakacsmedia.com/game v1.0.2)
- [x] Nuketown house walls/stairs/balcony invisible
- [x] Elevators, stairwells, walkable roofs/rooms missing (Vice Heights fountain elevator etc.)
- [x] Moving life missing: city traffic/parked cars, Dry Gulch train/riders/tumbleweeds/weather, alpine life, rain
- [x] Random time of day + weather per match
- [x] Minimap in his style (bottom-right, N marker, streets, elevator icons)
- [x] Version 1.0.5 (exact big maps: rooms, lifts, traffic, train, weather, events, his radar)
- [x] Version 1.0.6 (his gun look, his title/pause/recap screens, no explodables on big maps)

## v1.0.6 — his gun look + menus
- [x] Port his first-person gun models (art/guns.ts, art/GunView.tsx, muzzle, gunFx)
- [x] Port his home menu + pause menu look (his ui/kit; our logo line, co-op picker, stats sheet kept)
- [x] No shootable/explodable hazards on any big map
- [x] Home showcase: slow camera drift through the map, cycle every 18s

## v1.0.7
- Match setup, settings and enemies screens in his menu style
- Enemies button on the home menu (lineup + per-enemy 3D card)
