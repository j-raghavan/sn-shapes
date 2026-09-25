import React, {useEffect, useState} from 'react';
import ShapePalette from './src/ShapePalette';
import ShapeOptionsPanel from './src/ShapeOptionsPanel';
import {
  ButtonEvent,
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

type Route = {
  view: ReturnType<typeof viewForButtonId>;
  /** Bumped per button event; keys the Edit Shape panel. */
  session: number;
  /** The event this route was derived from, for reconciliation. */
  source: ButtonEvent | null;
};

function routeFor(event: ButtonEvent | null, session: number): Route {
  return {view: viewForButtonId(event?.id), session, source: event};
}

/**
 * Two views, chosen by the button that opened the plugin: the sidebar
 * "Shapes" button (id 100) opens the Shapes popup, the lasso-toolbar
 * "Shapes" button (id 200, #17) opens the Edit Shape panel.
 *
 * The initial view is read lazily from the router's cached last event so
 * the first render is already correct (sn-plugin-lib replays the event to
 * new listeners asynchronously; without the lazy read the palette would
 * flash first). The subscription only starts in the effect, so an event
 * delivered between that read and the subscription would be lost — the
 * effect therefore re-reads the last event once subscribed.
 *
 * Only the Edit Shape panel is keyed on `session`: every lasso press must
 * re-read the current selection, whereas the palette keeps its state
 * (selection, style, checkbox) across repeated sidebar presses.
 */
export default function App(): React.JSX.Element {
  const [route, setRoute] = useState<Route>(() => routeFor(getLastButtonEvent(), 0));

  useEffect(() => {
    const unsubscribe = subscribeToButtonEvents(event =>
      setRoute(r => routeFor(event, r.session + 1)),
    );
    const latest = getLastButtonEvent();
    setRoute(r => (latest && latest !== r.source ? routeFor(latest, r.session + 1) : r));
    return unsubscribe;
  }, []);

  return route.view === 'editShape' ? (
    <ShapeOptionsPanel key={route.session} />
  ) : (
    <ShapePalette />
  );
}
