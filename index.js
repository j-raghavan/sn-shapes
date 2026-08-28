import {AppRegistry, Image} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import {PluginManager} from 'sn-plugin-lib';
// Side-effect import: installs the single PluginManager.registerButtonListener
// used by ShapePalette (id=100) and prefixes dispatch logs with
// [PLUGIN_ROUTER] for logcat searchability.
import {installPluginRouter} from './src/pluginRouter';

const BUTTON_TYPE_TOOLBAR = 1;
const TOOLBAR_BUTTON_ID = 100;
const SHOW_TYPE_WITH_UI = 1;

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();
installPluginRouter();

// Chauvet enforces per-plugin file permissions. Everything under shared
// storage (Note, MyStyle, Document, …) is denied by default; only the
// plugin's own private dir is exempt. Both halves are required: the names
// must be declared in PluginConfig.json under `uses-permissions`
// (kebab-case — `usePermissions`/`usesPermissions` parse to null and are
// silently ignored), and each must then be requested at runtime.
// Declaration alone leaves hasPermission at 0; requesting an undeclared
// name throws "This permission has not been declared."
//
// READ gates PluginFileAPI.getPageSize (and the getElements family);
// WRITE gates the element-insert/modify calls this plugin makes on the
// open note. Without them the host either denies the call or, for the
// FileUtils path, throws SecurityException from inside the native module
// — which escapes synchronously and kills the plugin, uncatchable in JS.
// Ref: docs.supernote.com/en/plugin-base/permission
const requestFilePermissions = async () => {
  for (const name of [
    'plugin.permission.FILE:READ',
    'plugin.permission.FILE:WRITE',
  ]) {
    try {
      const had = await PluginManager.hasPermission(name);
      const got = had > 0 ? had : await PluginManager.requestPermission(name);
      console.log(`[PERM] ${name} -> ${got}`);
    } catch (e) {
      // Never fatal: a denial degrades the feature that needs it rather
      // than taking the plugin down.
      console.log(`[PERM] ${name} failed: ${e.message}`);
    }
  }
};
requestFilePermissions();

// Single entry point: the main toolbar "Shapes" button opens ShapePalette,
// which now handles all shape creation + styling in one popup. The
// previous lasso-toolbar "Shape Options" button (id=200) was removed per
// user direction 2026-04-18 — every option it offered (pen width, colour,
// type) is already set in ShapePalette at insert time, so the contextual
// re-style panel became redundant.
PluginManager.registerButton(BUTTON_TYPE_TOOLBAR, ['NOTE'], {
  id: TOOLBAR_BUTTON_ID,
  name: 'Shapes',
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: SHOW_TYPE_WITH_UI,
});
