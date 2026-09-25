import {AppRegistry, Image} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import {PluginManager} from 'sn-plugin-lib';
// installPluginRouter installs the single PluginManager.registerButtonListener
// that App.tsx routes on (id 100 → Shapes popup, id 200 → Edit Shape) and
// prefixes dispatch logs with [PLUGIN_ROUTER] for logcat searchability.
import {
  BUTTON_ID_LASSO,
  BUTTON_ID_TOOLBAR,
  installPluginRouter,
} from './src/pluginRouter';

const BUTTON_TYPE_TOOLBAR = 1;
const BUTTON_TYPE_LASSO_TOOLBAR = 2;
const SHOW_TYPE_WITH_UI = 1;
// editDataTypes filter values (PluginEditButton in sn-plugin-lib):
//   0 = Handwritten strokes, 1 = Title, 2 = Image, 3 = Text, 4 = Link,
//   5 = Geometric shapes. The lasso button is gated to [5] so it only
//   appears when a geometry is lassoed — the same registration the old
//   id=200 button used, confirmed on Chauvet 3.27.41(2274).
const EDIT_DATA_TYPE_GEOMETRY = 5;

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
// READ gates PluginFileAPI.getPageSize. Without it resolvePageSize()
// silently falls back to DEFAULT_PAGE_WIDTH/HEIGHT (1404x1872) — correct
// on a Nomad by coincidence, wrong on any device with different page
// dimensions, which mis-centres every inserted shape.
//
// WRITE is deliberately NOT declared: insertGeometry / modifyLassoGeometry
// are PluginCommAPI geometry ops and work with no permissions declared
// (verified on device). The docs' FILE:WRITE examples are the
// PluginFileAPI element calls, which this plugin does not use.
// Ref: docs.supernote.com/en/plugin-base/permission
const requestFilePermissions = async () => {
  for (const name of [
    'plugin.permission.FILE:READ',
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

const ICON_URI = Image.resolveAssetSource(require('./assets/icon.png')).uri;

// Sidebar "Shapes" button: opens the Shapes popup (pick, style, place).
PluginManager.registerButton(BUTTON_TYPE_TOOLBAR, ['NOTE'], {
  id: BUTTON_ID_TOOLBAR,
  name: 'Shapes',
  icon: ICON_URI,
  showType: SHOW_TYPE_WITH_UI,
});

// Lasso-toolbar "Shapes" button (#17): opens the Edit Shape panel, whose
// Resize freely stretches the lassoed shape without keeping its aspect
// ratio — the one thing the firmware lasso handle cannot do.
// Payload mirrors the device-verified id=200 registration from April
// (no showType; the SDK's PluginEditButton does not define one).
// DEVICE-UNVERIFIED on current Chauvet: visibility and placement (bar vs
// overflow menu).
PluginManager.registerButton(BUTTON_TYPE_LASSO_TOOLBAR, ['NOTE'], {
  id: BUTTON_ID_LASSO,
  name: 'Shapes',
  icon: ICON_URI,
  enable: true,
  editDataTypes: [EDIT_DATA_TYPE_GEOMETRY],
});
