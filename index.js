import {AppRegistry, Image} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import {PluginManager} from 'sn-plugin-lib';
// Side-effect import: installs the single PluginManager.registerButtonListener
// used by both ShapePalette (id=100) and ShapeOptionsPanel (id=200) and
// prefixes dispatch logs with [PLUGIN_ROUTER] for logcat searchability.
import {installPluginRouter} from './src/pluginRouter';

const BUTTON_TYPE_TOOLBAR = 1;
const BUTTON_TYPE_LASSO_TOOLBAR = 2;
const TOOLBAR_BUTTON_ID = 100;
// Shape Options contextual lasso-toolbar button. id=200 matches the pattern
// observed with the Sticker plugin (logcat line 13634) and keeps the two
// buttons trivially distinguishable both in logcat and in the router
// dispatch in App.tsx.
const SHAPE_OPTIONS_BUTTON_ID = 200;
const SHOW_TYPE_WITH_UI = 1;
// editDataTypes filter values (see PluginEditButton in sn-plugin-lib):
//   0 = Handwritten strokes, 1 = Title, 2 = Image, 3 = Text, 4 = Link,
//   5 = Geometric shapes. Shape Options is gated to [5] so it only appears
//   when a geometry is lassoed — confirmed working on Chauvet 3.27.41(2274).
const EDIT_DATA_TYPE_GEOMETRY = 5;

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();
installPluginRouter();

PluginManager.registerButton(BUTTON_TYPE_TOOLBAR, ['NOTE'], {
  id: TOOLBAR_BUTTON_ID,
  name: 'Shapes',
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: SHOW_TYPE_WITH_UI,
});

PluginManager.registerButton(BUTTON_TYPE_LASSO_TOOLBAR, ['NOTE'], {
  id: SHAPE_OPTIONS_BUTTON_ID,
  name: 'Shape Options',
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  enable: true,
  editDataTypes: [EDIT_DATA_TYPE_GEOMETRY],
});
