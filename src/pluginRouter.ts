/**
 * pluginRouter — single source of truth for plugin button press events.
 *
 * The Supernote plugin host dispatches button events into React Native via
 * `PluginManager.registerButtonListener`. index.js registers two buttons,
 * both named "Shapes": the sidebar button (id 100) opens the Shapes popup,
 * and the lasso-toolbar button (id 200, #17) opens the Edit Shape panel.
 * `ButtonEvent` carries no button type, so views are chosen by id alone
 * (`viewForButtonId`). We install exactly
 * one listener here and fan out to any subscribers (hooks / components)
 * so that:
 *
 *   1. We don't double-register with sn-plugin-lib.
 *   2. Log output stays prefixed with `[PLUGIN_ROUTER]` so logcat stays
 *      searchable.
 *   3. Components can read `getLastButtonEvent()` synchronously on first
 *      render to pick the right initial view, then
 *      `subscribeToButtonEvents` for any subsequent events that arrive
 *      during the plugin session.
 *
 * Why "last event" instead of an event stream? The plugin UI is started by
 * the button press itself; by the time `App.tsx` mounts the corresponding
 * event has typically already fired. `sn-plugin-lib` replays the cached
 * `lastButtonEventMsg` when a listener registers inside its 1-second
 * window, which is enough for us to capture the initial trigger into
 * module state before components mount.
 */
import {PluginManager} from 'sn-plugin-lib';

export const BUTTON_ID_TOOLBAR = 100;
export const BUTTON_ID_LASSO = 200;

export type ActiveView = 'palette' | 'editShape';

/** id 200 → the Edit Shape panel; anything else (100, unknown, none) → the palette. */
export function viewForButtonId(id: number | undefined): ActiveView {
  return id === BUTTON_ID_LASSO ? 'editShape' : 'palette';
}

// Mirror sn-plugin-lib's ButtonEvent shape locally so we don't depend on
// the library's internal sub-path (which isn't exported in its package
// exports map). Kept in sync with
// node_modules/sn-plugin-lib/src/listener/ButtonListener.ts.
export type ButtonEvent = {
  pressEvent: number;
  id: number;
  name: string;
  color: number;
  icon: string;
  bgColor: number;
};

export type ButtonSubscriber = (event: ButtonEvent) => void;

let lastEvent: ButtonEvent | null = null;
const subscribers = new Set<ButtonSubscriber>();
let installed = false;

export function installPluginRouter(): void {
  if (installed) {return;}
  installed = true;
  PluginManager.registerButtonListener({
    onButtonPress(event: ButtonEvent) {
      console.log('[PLUGIN_ROUTER] onButtonPress', JSON.stringify(event));
      lastEvent = event;
      for (const fn of subscribers) {
        try {
          fn(event);
        } catch (e) {
          console.error('[PLUGIN_ROUTER] subscriber threw', e);
        }
      }
    },
  });
}

export function getLastButtonEvent(): ButtonEvent | null {
  return lastEvent;
}

export function subscribeToButtonEvents(fn: ButtonSubscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

// --- Test-only helpers -----------------------------------------------------
// Jest resets modules between suites, but if a single test wants a clean
// slate without tearing down the whole module cache (e.g. for replay tests)
// it can use these. NOT exported for production use.
export const __testing__ = {
  reset(): void {
    lastEvent = null;
    subscribers.clear();
    installed = false;
  },
  getSubscriberCount(): number {
    return subscribers.size;
  },
  isInstalled(): boolean {
    return installed;
  },
};
