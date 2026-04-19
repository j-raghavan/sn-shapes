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
