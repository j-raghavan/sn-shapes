/**
 * Tests for App.tsx — view routing by the button that opened the plugin
 * (#17, SPEC-FREE-RESIZE FR8). The router is mocked so each test controls
 * the cached last event and the subscription.
 */
import React from 'react';
import {create, act, ReactTestRenderer} from 'react-test-renderer';

type Listener = (event: {id: number}) => void;
let mockLastEvent: {id: number} | null = null;
let mockListener: Listener | null = null;
// Simulates an event the host delivers while App subscribes (A2 race).
let mockOnSubscribe: (() => void) | null = null;

jest.mock('../src/pluginRouter', () => ({
  ...jest.requireActual('../src/pluginRouter'),
  installPluginRouter: jest.fn(),
  getLastButtonEvent: () => mockLastEvent,
  subscribeToButtonEvents: (fn: Listener) => {
    mockOnSubscribe?.();
    mockListener = fn;
    return () => {
      mockListener = null;
    };
  },
}));

jest.mock('sn-plugin-lib', () => ({
  PluginCommAPI: {
    getLassoGeometries: jest.fn().mockResolvedValue({success: true, result: []}),
    getLassoRect: jest.fn().mockResolvedValue({success: false}),
    getLassoElementTypeCounts: jest.fn().mockResolvedValue({success: false}),
    setLassoBoxState: jest.fn().mockResolvedValue({success: true}),
    getCurrentFilePath: jest.fn().mockResolvedValue({success: false}),
    getCurrentPageNum: jest.fn().mockResolvedValue({success: false}),
  },
  PluginFileAPI: {getPageSize: jest.fn()},
  PluginManager: {closePluginView: jest.fn()},
}));

import App from '../App';
import {Text} from 'react-native';
import {TEST_IDS as PALETTE_IDS} from '../src/ShapePalette';
import {TEST_IDS as EDIT_IDS} from '../src/ShapeOptionsPanel';
import {PluginCommAPI} from 'sn-plugin-lib';

function flushPromises() {
  return new Promise(resolve =>
    jest.requireActual<typeof globalThis>('timers').setImmediate(resolve),
  );
}

const has = (tree: ReactTestRenderer, testID: string) =>
  tree.root.findAllByProps({testID}).length > 0;

async function mount(): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(<App />);
  });
  await act(async () => { await flushPromises(); await flushPromises(); });
  return tree!;
}

async function press(id: number) {
  await act(async () => {
    // The real router records the event before fanning it out.
    mockLastEvent = {id};
    mockListener!(mockLastEvent);
    await flushPromises();
    await flushPromises();
  });
}

let logSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
beforeEach(() => {
  mockLastEvent = null;
  mockListener = null;
  mockOnSubscribe = null;
  (PluginCommAPI.getLassoGeometries as jest.Mock).mockClear();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  // The lasso view mounts with failed counts reads, so it warns that it is
  // falling back to the geometry list.
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

describe('App routing (AC8.2)', () => {
  it('shows the palette when no button event has been seen', async () => {
    const tree = await mount();
    expect(has(tree, PALETTE_IDS.panel)).toBe(true);
    expect(has(tree, EDIT_IDS.card)).toBe(false);
  });

  it('shows Edit Shape on first render when the lasso button opened the plugin', async () => {
    mockLastEvent = {id: 200};
    const tree = await mount();
    expect(has(tree, EDIT_IDS.card)).toBe(true);
    expect(has(tree, PALETTE_IDS.panel)).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith('[EDIT_SHAPE] counts unavailable, falling back to geometry list');
  });

  it('follows later button events in both directions', async () => {
    const tree = await mount();
    await press(200);
    expect(has(tree, EDIT_IDS.card)).toBe(true);
    await press(100);
    expect(has(tree, PALETTE_IDS.panel)).toBe(true);
    expect(has(tree, EDIT_IDS.card)).toBe(false);
  });

  it('remounts Edit Shape on a repeated lasso press so the lasso is read again', async () => {
    mockLastEvent = {id: 200};
    await mount();
    expect(PluginCommAPI.getLassoGeometries).toHaveBeenCalledTimes(1);
    await press(200);
    expect(PluginCommAPI.getLassoGeometries).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes on unmount', async () => {
    const tree = await mount();
    expect(mockListener).not.toBeNull();
    act(() => tree.unmount());
    expect(mockListener).toBeNull();
  });

  it('A1: a repeated sidebar press keeps the palette state (no remount)', async () => {
    const tree = await mount();
    const label = () => tree.root.findByProps({testID: PALETTE_IDS.groupLabel}).findByType(Text).props.children;
    const before = label();
    await act(async () => {
      tree.root.findByProps({testID: PALETTE_IDS.groupNext}).props.onPress();
      await flushPromises();
    });
    const moved = label();
    expect(moved).not.toBe(before);
    await press(100);
    expect(label()).toBe(moved);
  });

  it('A2: an event delivered before the subscription lands is not lost', async () => {
    mockOnSubscribe = () => {
      mockLastEvent = {id: 200};
    };
    const tree = await mount();
    expect(has(tree, EDIT_IDS.card)).toBe(true);
  });

  it('A2: reconciling with the event already routed changes nothing', async () => {
    mockLastEvent = {id: 200};
    await mount();
    // The lazy read and the post-subscribe read see the same event, so the
    // panel mounts once and reads the lasso once.
    expect(PluginCommAPI.getLassoGeometries).toHaveBeenCalledTimes(1);
  });
});
