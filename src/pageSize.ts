/**
 * Page context shared by every view that maps pen touches onto the page:
 * the Shapes popup (insert) and the Edit Shape panel (resize, #17).
 * Extracted from ShapePalette.tsx unchanged so both views agree on the
 * page size and on the dp → page px scale.
 */
import {PixelRatio} from 'react-native';
import {PluginCommAPI, PluginFileAPI} from 'sn-plugin-lib';
import {PageSize} from './placement';

export const DEFAULT_PAGE_WIDTH = 1404;
export const DEFAULT_PAGE_HEIGHT = 1872;

// Local narrow type for sn-plugin-lib responses. The SDK declares its
// methods as returning the generic `Object` type, so TS doesn't know
// about the `{success, result}` envelope the firmware actually returns.
export type ApiRes<T> = {success: boolean; result?: T; error?: {message?: string}} | null | undefined;

// dp → page px. `sn-plugin-lib` documents geometry points as Android
// screen px and RN reports touches in dp (px / density), so one multiply
// recovers the firmware coordinate space. Constant per device, hence
// module-level (ADR-PEN-PLACEMENT D2). DEVICE-UNVERIFIED on Manta.
export const TOUCH_SCALE = PixelRatio.get();

/** Current page size from the firmware; never throws (falls back to the defaults). */
export async function resolvePageSize(): Promise<PageSize> {
  try {
    // Fire both independent calls concurrently; getPageSize waits for both.
    const [pathRaw, pageRaw] = await Promise.all([
      PluginCommAPI.getCurrentFilePath(),
      PluginCommAPI.getCurrentPageNum(),
    ]);
    const pathRes = pathRaw as ApiRes<string>;
    const pageRes = pageRaw as ApiRes<number>;
    if (
      pathRes?.success &&
      pageRes?.success &&
      typeof pathRes.result === 'string' &&
      typeof pageRes.result === 'number'
    ) {
      const sizeRes = (await PluginFileAPI.getPageSize(
        pathRes.result,
        pageRes.result,
      )) as ApiRes<PageSize>;
      if (sizeRes?.success && sizeRes.result) {
        return sizeRes.result;
      }
    }
  } catch {
    // Fall through to defaults.
  }
  return {width: DEFAULT_PAGE_WIDTH, height: DEFAULT_PAGE_HEIGHT};
}
