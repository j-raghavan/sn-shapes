import React, {useEffect, useState} from 'react';
import ShapePalette from './src/ShapePalette';
import ShapeOptionsPanel from './src/ShapeOptionsPanel';
import {
  getLastButtonEvent,
  installPluginRouter,
  subscribeToButtonEvents,
  viewForButtonId,
} from './src/pluginRouter';

// Install the router listener eagerly — idempotent, so safe to call from
// both here and index.js. We do it here as well because some test
// harnesses render App.tsx without executing index.js; production order
// is: index.js → AppRegistry.registerComponent → App is instantiated →
// listener confirmed installed.
installPluginRouter();

/**
 * Two views, chosen by the button that opened the plugin: the sidebar
 * "Shapes" button (id 100) opens the Shapes popup, the lasso-toolbar
 * "Shapes" button (id 200, #17) opens the Edit Shape panel.
 *
 * The initial view is read lazily from the router's cached last event so
 * the first render is already correct (sn-plugin-lib replays the event to
 * new listeners asynchronously; without the lazy read the palette would
 * flash first). Every later event bumps `session`, which keys the view so
 * it remounts: each press re-reads the current lasso instead of showing a
 * previous session's state.
 */
export default function App(): React.JSX.Element {
  const [route, setRoute] = useState(() => ({
    view: viewForButtonId(getLastButtonEvent()?.id),
    session: 0,
  }));

  useEffect(
    () =>
      subscribeToButtonEvents(event =>
        setRoute(r => ({view: viewForButtonId(event.id), session: r.session + 1})),
      ),
    [],
  );

  return route.view === 'editShape' ? (
    <ShapeOptionsPanel key={route.session} />
  ) : (
    <ShapePalette key={route.session} />
  );
}
