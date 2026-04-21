# Shapes Plugin for Supernote

![Tests](https://img.shields.io/badge/tests-198%20passed-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-97.8%25-brightgreen)
![Lint](https://img.shields.io/badge/lint-passing-brightgreen)
![Platform](https://img.shields.io/badge/platform-Supernote-blue)
![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-1.0.3-blue)

A toolbar plugin for Supernote that lets you insert geometric shapes directly into your notes.

## Demo

### v1.4.0
<video src="https://github.com/user-attachments/assets/af76ff12-1867-4b54-aec2-8d8e13845731" controls muted playsinline widh="720"></video

<!--
<video src="https://github.com/user-attachments/assets/298211f3-0039-4edd-aee5-6f1259272cc2" controls muted playsinline width="720"></video>
-->

## What's New in v1.0.4

- **One popup, one tap to insert**: pick a shape, tweak the colour and stroke width, then tap outside to drop it on the page. No extra Insert button needed.
- **Live preview**: see exactly what your shape will look like, colour and thickness, before it lands on the page.
- **Auto-select after insert**: the shape you just placed is already lassoed, so you can drag, resize, or move it without an extra tap.
- **Smaller, less intrusive popup**: the panel takes up roughly 40% less of your page so you can keep drawing around it.
- **Added** ~19 new pure-vector shapes:
    - **Arrows**: ball arrow, chevron-tail arrow, refresh/loop arrow, thick arrow, double arrow, block arrow
    - **Basic**: rectangle, trapezoid, plus, lightning bolt   
    - **Flowchart**: document, manual input, preparation, terminator
    - **Decorative**: certificate, ribbon, banner, starburst (SALE-sticker spiked oval), award badge (medallion with V-notched tails)
- Popup is ~20% larger — the old one felt cramped on the A5 display.
- Popup size is now fixed. It no longer jumps/resizes when you flip between Basic / Arrows / Flowchart / Decorative / Others.
- Carousel category arrows redesigned — dropped the off-center circle, the triangle glyph is now the whole affordance and sits properly centered.
- Leaner .snplg bundle — no more bundled raster assets.


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
