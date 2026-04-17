/**
 * Tests for src/pluginRouter. Validate that:
 *   - installPluginRouter registers exactly one PluginManager listener
 *     regardless of how many times it's called (idempotent).
 *   - onButtonPress updates getLastButtonEvent and fans out to every active
 *     subscriber.
 *   - Subscribers can unsubscribe via the returned handle.
 *   - A throwing subscriber doesn't block other subscribers from being
 *     invoked (important: one badly-written consumer shouldn't silently
 *     eat events for everyone else).
 */
type ButtonListenerShape = {
  onButtonPress: (event: unknown) => void;
};

const registeredListeners: ButtonListenerShape[] = [];

jest.mock('sn-plugin-lib', () => ({
  PluginManager: {
    registerButtonListener: jest.fn((listener: ButtonListenerShape) => {
      registeredListeners.push(listener);
      return {id: registeredListeners.length - 1, listener, remove: jest.fn()};
    }),
  },
}));

import {
  installPluginRouter,
  subscribeToButtonEvents,
  getLastButtonEvent,
  __testing__,
  BUTTON_ID_TOOLBAR,
  BUTTON_ID_SHAPE_OPTIONS,
} from '../src/pluginRouter';

beforeEach(() => {
  registeredListeners.length = 0;
  __testing__.reset();
});

describe('pluginRouter', () => {
  it('exports the expected button id constants', () => {
    expect(BUTTON_ID_TOOLBAR).toBe(100);
    expect(BUTTON_ID_SHAPE_OPTIONS).toBe(200);
  });

  it('installs a single listener on first call', () => {
    installPluginRouter();
    expect(registeredListeners).toHaveLength(1);
    expect(__testing__.isInstalled()).toBe(true);
  });

  it('is idempotent across repeated calls', () => {
    installPluginRouter();
    installPluginRouter();
    installPluginRouter();
    expect(registeredListeners).toHaveLength(1);
  });

  it('records the last button event for synchronous reads', () => {
    installPluginRouter();
    expect(getLastButtonEvent()).toBeNull();
    const event = {id: 200, pressEvent: 3, name: 'Shape Options', icon: '', color: 0, bgColor: 0};
    registeredListeners[0].onButtonPress(event);
    expect(getLastButtonEvent()).toEqual(event);
  });

  it('fans events out to subscribers', () => {
    installPluginRouter();
    const a = jest.fn();
    const b = jest.fn();
    subscribeToButtonEvents(a);
    subscribeToButtonEvents(b);
    const event = {id: 100, pressEvent: 3, name: 'Shapes', icon: '', color: 0, bgColor: 0};
    registeredListeners[0].onButtonPress(event);
    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledWith(event);
  });

  it('removes subscribers via returned unsubscribe handle', () => {
    installPluginRouter();
    const fn = jest.fn();
    const unsubscribe = subscribeToButtonEvents(fn);
    expect(__testing__.getSubscriberCount()).toBe(1);
    unsubscribe();
    expect(__testing__.getSubscriberCount()).toBe(0);
    registeredListeners[0].onButtonPress({id: 100, pressEvent: 3, name: '', icon: '', color: 0, bgColor: 0});
    expect(fn).not.toHaveBeenCalled();
  });

  it('isolates subscriber exceptions so other subscribers still fire', () => {
    installPluginRouter();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const thrower = jest.fn(() => {
        throw new Error('boom');
      });
      const healthy = jest.fn();
      subscribeToButtonEvents(thrower);
      subscribeToButtonEvents(healthy);
      registeredListeners[0].onButtonPress({id: 200, pressEvent: 3, name: '', icon: '', color: 0, bgColor: 0});
      expect(thrower).toHaveBeenCalled();
      expect(healthy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
