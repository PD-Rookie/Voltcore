# VOLTCORE // Deflect Protocol

A self-contained neon arcade defense game built with vanilla HTML5 Canvas, CSS, and JavaScript. No frameworks, no build step, no external assets.

Turn incoming fire into your weapon: aim the hardlight shield, deflect bullets back into the drones that fired them, and unleash NOVA when your flux meter is full.

## Play

Open `index.html` in a browser, or serve the folder locally:

```powershell
npx serve .
```

## Controls

| Action | Input |
| --- | --- |
| Aim shield | Mouse / touch drag |
| Rotate shield | `A` / `D` or `Left` / `Right` |
| NOVA | `Space` |
| Pause | `P` or `Esc` |
| Mute | `M` |

## Features

- Deflect-and-counter combat loop with a shield arc you aim manually
- Wave-based enemy drones with distinct firing patterns
- Perfect-parry timing, chain multipliers, and a flux meter that powers NOVA
- Between-wave upgrades and persistent best score / achievements via `localStorage`
- Procedural audio via the Web Audio API (no sound files)
- Responsive canvas with DPR scaling and reduced-motion support

## Project layout

```
index.html   Markup, HUD, and overlay screens
style.css    Neon UI, layout, and effects
script.js    Game engine, rendering, audio, and persistence
```

## Deploy

Static host friendly. GitHub Pages is the simplest option:

1. Repository **Settings** -> **Pages**
2. **Source**: Deploy from a branch
3. Branch: `main`, folder: `/ (root)` -> **Save**

The game is then live at `https://pd-rookie.github.io/Voltcore/`.

## License

MIT
