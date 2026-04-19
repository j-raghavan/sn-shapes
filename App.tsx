import React from 'react';
import ShapePalette from './src/ShapePalette';
import {installPluginRouter} from './src/pluginRouter';

// Install the router listener eagerly — idempotent, so safe to call from
// both here and index.js. We do it here as well because some test
// harnesses render App.tsx without executing index.js; production order
// is: index.js → AppRegistry.registerComponent → App is instantiated →
// listener confirmed installed.
//
// Single-view app: the only registered button is id=100 "Shapes", which
// opens the ShapePalette popup. The former id=200 "Shape Options"
// lasso-toolbar button + ShapeOptionsPanel routing were removed per user
// direction 2026-04-18 — every option ShapeOptionsPanel offered is now
// built into ShapePalette itself.
installPluginRouter();

export default function App(): React.JSX.Element {
  return <ShapePalette />;
}
