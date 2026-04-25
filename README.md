# Shapes Plugin for Supernote

![Tests](https://img.shields.io/badge/tests-198%20passed-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-97.8%25-brightgreen)
![Lint](https://img.shields.io/badge/lint-passing-brightgreen)
![Platform](https://img.shields.io/badge/platform-Supernote-blue)
![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-1.0.5-blue)

A toolbar plugin for Supernote that lets you insert geometric shapes directly into your notes.

## Demo

### v1.5.0
<video src="https://github.com/user-attachments/assets/658057de-70bc-45a2-aaa3-77736d3853cf" controls muted playsinline widh="720"></video>


<!--
<video src="https://github.com/user-attachments/assets/298211f3-0039-4edd-aee5-6f1259272cc2" controls muted playsinline width="720"></video>
-->

## What's New in v1.0.5

  1. New "♡ Favorites" category, listed first in the carousel. Carousel cycles favorites → basic → arrows → flowchart → decorative → others; landing tab stays basic (so a fresh-install user doesn't open onto an empty grid), with favorites one ◀
  tap away.
  2. Heart toggle in the preview column. Single ♡/❤ Pressable next to the StrokePreview — taps the currently-selected shape into or out of favorites. Disabled while storage is hydrating and on the empty-favorites tab.
  3. Persistent favorites with a swappable storage adapter. New src/favoritesStorage.ts exposes a FavoritesStorage interface with three implementations: AsyncStorage-backed (lazy-required, so its absence isn't fatal), in-memory fallback (used
  when the dep isn't installed and by tests), and a memoised default factory. Versioned envelope on disk, defensive parse, cap enforcement at both read and write boundaries.
  4. Pure favorites domain helpers in shapes.ts. isFavorite, addFavorite, removeFavorite, toggleFavorite (returns {favorites, status}), and favoriteShapes(list) — all immutable, all unit-tested. Hydration sanitises against KNOWN_SHAPE_IDS so
  removed shapes can't accumulate as orphans, and the toggle handler is hydration-gated + StrictMode-safe.
  5. Test coverage: 382 tests across 7 suites, lint + type-check clean. New __tests__/favoritesStorage.test.ts (round-trip, defensive parse, cap, error swallowing, memoisation reset). New favorites cases in ShapePalette.test.tsx (heart toggle
  UI/state, empty placeholder, hydration, persistence, render-order, auto-select on entry, orphan sanitisation, hydration-disabled state). Reducer-level cap tests in shapes.test.ts.


## How to Use

1. Open a note on your Supernote.
2. Tap the **Plugins** icon in the left toolbar (the puzzle piece).
3. Tap **Shapes** to open the popup.
4. Tap a shape in the grid to select it, then tune **Stroke Width** (XS / S / M / L / XL) and **Stroke Color** using the pickers below. The live preview updates as you go.
5. Tap **anywhere outside the popup** to commit. The shape is inserted centered on the current page and auto-lassoed so you can reposition or resize it straight away.
6. To dismiss without inserting, tap the ✕ in the popup header.

## Building

Make sure you have Node.js 18+ installed, then:

```sh
npm install
./buildPlugin.sh
```

This produces `build/outputs/SnShapes.snplg`.

## Installing on the Device

Use the Supernote Partner App to copy `build/outputs/SnShapes.snplg` to the `MyStyles` folder on your device. Then on the Supernote, navigate to `Settings -> Apps -> Plugins -> Add Plugin` to add the plugin to your Supernote.

## Running Tests

```sh
npm test
```

## Linting

```sh
npm run lint
```

## Project Structure

```
src/
  shapes.ts          Shape definitions and geometry helpers
  ShapePalette.tsx   Unified Shapes popup (grid, preview, pickers)
  StrokePreview.tsx  Live preview panel
assets/
  icon.png           Toolbar icon
  shapes/            Shape thumbnail images
index.js             Plugin entry point (toolbar button registration)
App.tsx              React Native root component
```

---

Hope you enjoy using this plugin as much as I enjoyed developing it. If you find any issues, please feel free to raise an [Issue](https://github.com/j-raghavan/sn-shapes/issues).
