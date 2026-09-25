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

jest.mock('../src/pluginRouter', () => ({
  ...jest.requireActual('../src/pluginRouter'),
  installPluginRouter: jest.fn(),
  getLastButtonEvent: () => mockLastEvent,
  subscribeToButtonEvents: (fn: Listener) => {
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
    getCurrentFilePath: jest.fn().mockResolvedValue({success: false}),
    getCurrentPageNum: jest.fn().mockResolvedValue({success: false}),
  },
  PluginFileAPI: {getPageSize: jest.fn()},
  PluginManager: {closePluginView: jest.fn()},
}));

import App from '../App';
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
    mockListener!({id});
    await flushPromises();
    await flushPromises();
  });
}

let logSpy: jest.SpyInstance;
beforeEach(() => {
  mockLastEvent = null;
  mockListener = null;
  (PluginCommAPI.getLassoGeometries as jest.Mock).mockClear();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
});

describe('App routing (AC8.2)', () => {
  it('shows the palette when no button event has been seen', async () => {
    const tree = await mount();
    expect(has(tree, PALETTE_IDS.panel)).toBe(true);
    expect(has(tree, EDIT_IDS.panel)).toBe(false);
  });

  it('shows Edit Shape on first render when the lasso button opened the plugin', async () => {
    mockLastEvent = {id: 200};
    const tree = await mount();
    expect(has(tree, EDIT_IDS.panel)).toBe(true);
    expect(has(tree, PALETTE_IDS.panel)).toBe(false);
  });

  it('follows later button events in both directions', async () => {
    const tree = await mount();
    await press(200);
    expect(has(tree, EDIT_IDS.panel)).toBe(true);
    await press(100);
    expect(has(tree, PALETTE_IDS.panel)).toBe(true);
    expect(has(tree, EDIT_IDS.panel)).toBe(false);
  });

  it('remounts the view on a repeated press so the lasso is read again', async () => {
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
});
