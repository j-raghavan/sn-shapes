import React from 'react';
import {create, act, ReactTestRenderer} from 'react-test-renderer';
import {Image} from 'react-native';

jest.mock('sn-plugin-lib', () => {
  return {
    PluginCommAPI: {
      insertGeometry: jest.fn().mockResolvedValue({success: true}),
      getCurrentFilePath: jest.fn().mockResolvedValue({success: true, result: '/note/test.note'}),
      getCurrentPageNum: jest.fn().mockResolvedValue({success: true, result: 0}),
    },
    PluginFileAPI: {
      getPageSize: jest.fn().mockResolvedValue({success: true, result: {width: 1404, height: 1872}}),
    },
    PluginManager: {
      closePluginView: jest.fn().mockResolvedValue(true),
    },
  };
});

import ShapePalette, {
  TEST_IDS,
  DEFAULT_PAGE_WIDTH,
  SHAPE_ICONS,
} from '../src/ShapePalette';
import {SHAPES} from '../src/shapes';
import {PluginCommAPI, PluginManager, PluginFileAPI} from 'sn-plugin-lib';

function flushPromises() {
  return new Promise(resolve =>
    jest.requireActual<typeof globalThis>('timers').setImmediate(resolve)
  );
}

function findByTestID(tree: ReactTestRenderer, testID: string) {
  return tree.root.findByProps({testID});
}

function findAllCells(tree: ReactTestRenderer) {
  return SHAPES.map(s => findByTestID(tree, TEST_IDS.cell(s.id)));
}

let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  (PluginCommAPI.insertGeometry as jest.Mock).mockClear();
  (PluginCommAPI.getCurrentFilePath as jest.Mock).mockClear();
  (PluginCommAPI.getCurrentPageNum as jest.Mock).mockClear();
  (PluginFileAPI.getPageSize as jest.Mock).mockClear();
  (PluginManager.closePluginView as jest.Mock).mockClear();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  consoleErrorSpy.mockRestore();
});

describe('ShapePalette', () => {
  it('renders without crashing', () => {
    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette />);
    });
    expect(tree!.toJSON()).toBeTruthy();
  });

  it('has an icon defined for every shape', () => {
    SHAPES.forEach(shape => {
      expect(SHAPE_ICONS).toHaveProperty(shape.id);
    });
  });

  it('renders a cell for each shape', () => {
    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette />);
    });
    expect(findAllCells(tree!)).toHaveLength(SHAPES.length);
  });

  it('renders an image thumbnail in each cell', () => {
    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette />);
    });
    const images = tree!.root.findAllByType(Image);
    expect(images).toHaveLength(SHAPES.length);
  });

  it('closes plugin view when overlay is pressed', async () => {
    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette />);
    });

    await act(async () => {
      findByTestID(tree!, TEST_IDS.overlay).props.onPress();
      await flushPromises();
    });

    expect(PluginManager.closePluginView).toHaveBeenCalled();
  });

  it('closes plugin view after successful shape insertion', async () => {
    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette />);
    });

    await act(async () => {
      findByTestID(tree!, TEST_IDS.cell('rectangle')).props.onPress();
      // Since insertShape has multiple await steps, we might need multiple flushes
      await flushPromises();
      await flushPromises();
      await flushPromises();
    });

    expect(PluginCommAPI.insertGeometry).toHaveBeenCalled();
    expect(PluginManager.closePluginView).toHaveBeenCalled();
  });

  it('does not close plugin view when insertion fails and shows error banner', async () => {
    (PluginCommAPI.insertGeometry as jest.Mock).mockRejectedValueOnce(
      new Error('failed'),
    );

    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette />);
    });

    await act(async () => {
      findByTestID(tree!, TEST_IDS.cell('rectangle')).props.onPress();
      await flushPromises();
    });

    expect(PluginManager.closePluginView).not.toHaveBeenCalled();
    const errorBanner = findByTestID(tree!, TEST_IDS.error);
    expect(errorBanner).toBeTruthy();
  });

  it('does not show error banner after successful insertion', async () => {
    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette />);
    });

    await act(async () => {
      findByTestID(tree!, TEST_IDS.cell('rectangle')).props.onPress();
      await flushPromises();
    });

    expect(() => findByTestID(tree!, TEST_IDS.error)).toThrow();
  });

  it('clears error banner on successful retry', async () => {
    (PluginCommAPI.insertGeometry as jest.Mock).mockRejectedValueOnce(
      new Error('failed'),
    );

    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette />);
    });

    await act(async () => {
      findByTestID(tree!, TEST_IDS.cell('rectangle')).props.onPress();
      await flushPromises();
    });

    expect(findByTestID(tree!, TEST_IDS.error)).toBeTruthy();

    (PluginCommAPI.insertGeometry as jest.Mock).mockResolvedValueOnce({success: true});

    await act(async () => {
      findByTestID(tree!, TEST_IDS.cell('circle')).props.onPress();
      await flushPromises();
    });

    expect(() => findByTestID(tree!, TEST_IDS.error)).toThrow();
  });

  it('auto-dismisses error banner after timeout', async () => {
    jest.useFakeTimers();

    (PluginCommAPI.insertGeometry as jest.Mock).mockRejectedValueOnce(new Error('failed'));

    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette />);
    });

    await act(async () => {
      findByTestID(tree!, TEST_IDS.cell('rectangle')).props.onPress();
      await flushPromises();
    });

    // The banner should be visible
    expect(() => findByTestID(tree!, TEST_IDS.error)).not.toThrow();

    // Advance the fake clock past your banner's timeout duration
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // The banner should now be gone
    expect(() => findByTestID(tree!, TEST_IDS.error)).toThrow();

    // CRITICAL: Restore real timers so the next tests don't freeze!
    jest.useRealTimers();
  });

  it('resolves page size via API chain before inserting', async () => {
    (PluginCommAPI.getCurrentFilePath as jest.Mock).mockResolvedValueOnce(
      {success: true, result: '/note/my.note'},
    );
    (PluginCommAPI.getCurrentPageNum as jest.Mock).mockResolvedValueOnce(
      {success: true, result: 3},
    );
    (PluginFileAPI.getPageSize as jest.Mock).mockResolvedValueOnce(
      {success: true, result: {width: 1920, height: 2560}},
    );

    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette />);
    });

    await act(async () => {
      await flushPromises(); // let mount's resolvePageSize complete
    });

    await act(async () => {
      findByTestID(tree!, TEST_IDS.cell('square')).props.onPress();
      await flushPromises();
    });

    expect(PluginCommAPI.getCurrentFilePath).toHaveBeenCalled();
    expect(PluginCommAPI.getCurrentPageNum).toHaveBeenCalled();
    expect(PluginFileAPI.getPageSize).toHaveBeenCalledWith('/note/my.note', 3);

    const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
    expect(geo.type).toBe('GEO_polygon');
    const xs = geo.points.map((p: {x: number}) => p.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    expect((minX + maxX) / 2).toBeCloseTo(1920 / 2, -1);
  });

  it('inserts circle geometry for circle shape', async () => {
    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette />);
    });

    await act(async () => {
      findByTestID(tree!, TEST_IDS.cell('circle')).props.onPress();
      await flushPromises();
    });

    const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
    expect(geo.type).toBe('GEO_circle');
    expect(geo.ellipseCenterPoint).toBeDefined();
    expect(geo.ellipseMajorAxisRadius).toBe(geo.ellipseMinorAxisRadius);
  });

  it('falls back to defaults when getCurrentFilePath fails', async () => {
    (PluginCommAPI.getCurrentFilePath as jest.Mock).mockRejectedValueOnce(
      new Error('unavailable'),
    );

    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette />);
    });

    await act(async () => {
      await flushPromises(); // let mount's resolvePageSize complete
    });

    await act(async () => {
      findByTestID(tree!, TEST_IDS.cell('square')).props.onPress();
      await flushPromises();
    });

    expect(PluginFileAPI.getPageSize).not.toHaveBeenCalled();
    expect(PluginCommAPI.insertGeometry).toHaveBeenCalled();
    const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
    const xs = geo.points.map((p: {x: number}) => p.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(DEFAULT_PAGE_WIDTH / 2, -1);
  });

  it('falls back to defaults when getPageSize fails', async () => {
    (PluginFileAPI.getPageSize as jest.Mock).mockRejectedValueOnce(
      new Error('unavailable'),
    );

    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette />);
    });

    await act(async () => {
      findByTestID(tree!, TEST_IDS.cell('rectangle')).props.onPress();
      await flushPromises();
    });

    expect(PluginCommAPI.insertGeometry).toHaveBeenCalled();
    const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
    const xs = geo.points.map((p: {x: number}) => p.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(DEFAULT_PAGE_WIDTH / 2, -1);
  });

  it('ignores rapid double-tap while insertion is in progress', async () => {
    let resolveInsert: () => void;
    (PluginCommAPI.insertGeometry as jest.Mock).mockImplementationOnce(
      () => new Promise<void>(r => { resolveInsert = r; }),
    );

    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette />);
    });

    // We don't await the first press, we want it to be "in progress"
    act(() => {
       findByTestID(tree!, TEST_IDS.cell('rectangle')).props.onPress();
    });

    // Now await flushPromises to let the mock get called and resolveInsert get set
    await act(async () => {
        await flushPromises();
    });

    // The second tap happens while it's in progress
    await act(async () => {
      findByTestID(tree!, TEST_IDS.cell('circle')).props.onPress();
      await flushPromises();
    });

    expect(PluginCommAPI.insertGeometry).toHaveBeenCalledTimes(1);

    // Now resolve the first insert
    await act(async () => {
      // Ensure resolveInsert is defined before calling
      if (resolveInsert) {
         resolveInsert();
      }
      await flushPromises();
    });
  });

  it('allows new insertion after failure', async () => {
    (PluginCommAPI.insertGeometry as jest.Mock).mockRejectedValueOnce(
      new Error('failed'),
    );

    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette />);
    });

    await act(async () => {
      findByTestID(tree!, TEST_IDS.cell('rectangle')).props.onPress();
      await flushPromises();
    });

    (PluginCommAPI.insertGeometry as jest.Mock).mockResolvedValueOnce({success: true});

    await act(async () => {
      findByTestID(tree!, TEST_IDS.cell('circle')).props.onPress();
      await flushPromises();
    });

    expect(PluginCommAPI.insertGeometry).toHaveBeenCalledTimes(2);
  });
});
