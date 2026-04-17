import React, {useEffect, useState} from 'react';
import ShapePalette from './src/ShapePalette';
import ShapeOptionsPanel from './src/ShapeOptionsPanel';
import {
  BUTTON_ID_SHAPE_OPTIONS,
  BUTTON_ID_TOOLBAR,
  getLastButtonEvent,
  installPluginRouter,
  subscribeToButtonEvents,
} from './src/pluginRouter';

// Install the router listener eagerly — idempotent, so safe to call from
// both here and index.js. We do it here as well because some test
// harnesses render App.tsx without executing index.js; production order
// is: index.js → AppRegistry.registerComponent → App is instantiated →
// useEffect fires → listener confirmed installed.
installPluginRouter();

type ActiveView = 'palette' | 'shape-options';

function viewForButtonId(id: number | undefined): ActiveView {
  return id === BUTTON_ID_SHAPE_OPTIONS ? 'shape-options' : 'palette';
}

export default function App(): React.JSX.Element {
  // Lazy initial state reads the router's cached "last event" synchronously
  // so the first render picks the right view. This matters because
  // sn-plugin-lib replays the button event to newly-registered listeners
  // inside its 1-second cache window, but that replay fires asynchronously
  // — without this lazy read we'd flicker the palette before switching.
  const [view, setView] = useState<ActiveView>(() =>
    viewForButtonId(getLastButtonEvent()?.id),
  );

  useEffect(() => {
    return subscribeToButtonEvents(event => {
      setView(viewForButtonId(event.id));
    });
  }, []);

  if (view === 'shape-options') {
    return <ShapeOptionsPanel />;
  }

  // Default: main toolbar button (id=100) or unknown — show the palette.
  // Referencing the constant keeps the type-export alive and makes the
  // mapping symmetric/greppable.
  void BUTTON_ID_TOOLBAR;
  return <ShapePalette />;
}
