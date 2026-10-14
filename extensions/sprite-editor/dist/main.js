"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: !0 });
}, __copyProps = (to, from, except, desc) => {
  if (from && typeof from == "object" || typeof from == "function")
    for (let key of __getOwnPropNames(from))
      !__hasOwnProp.call(to, key) && key !== except && __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: !0 }), mod);

// source/main.ts
var main_exports = {};
__export(main_exports, {
  load: () => load,
  methods: () => methods,
  unload: () => unload
});
module.exports = __toCommonJS(main_exports);

// package.json
var package_default = {
  $schema: "./@types/schema/package/index.json",
  package_version: 2,
  name: "sprite-editor",
  version: "1.0.0",
  author: "Thanh Hoang",
  editor: ">=3.8.6",
  scripts: {
    preinstall: "node ./scripts/preinstall.js",
    build: "tsc && node ./scripts/build.js",
    watch: "node ./scripts/build.js --watch",
    typecheck: "tsc",
    test: "node ./tests/run.js",
    preview: "node ./tests/preview/build.js"
  },
  description: "i18n:sprite-editor.description",
  main: "./dist/main.js",
  devDependencies: {
    "@cocos/creator-types": "^3.8.6",
    "@types/node": "^18.17.1",
    esbuild: "^0.24.2",
    typescript: "^5.8.2",
    vue: "^3.1.4"
  },
  panels: {
    default: {
      title: "Sprite Editor",
      type: "dockable",
      main: "dist/panels/default",
      size: {
        "min-width": 560,
        "min-height": 360,
        width: 1180,
        height: 760
      }
    }
  },
  contributions: {
    menu: [
      {
        path: "i18n:menu.panel",
        label: "i18n:sprite-editor.open_panel",
        message: "open-panel"
      }
    ],
    messages: {
      "open-panel": {
        methods: ["openPanel"]
      },
      "edit-asset": {
        methods: ["editAsset"]
      },
      "take-pending": {
        methods: ["takePending"]
      },
      "panel-load-asset": {
        methods: ["default.loadAsset"]
      },
      "selection:select": {
        methods: ["default.onSelectionSelect"]
      },
      "asset-db:asset-change": {
        methods: ["default.onAssetChange"]
      },
      "shortcut-undo": {
        methods: ["default.shortcutUndo"]
      },
      "shortcut-redo": {
        methods: ["default.shortcutRedo"]
      },
      "shortcut-apply": {
        methods: ["default.shortcutApply"]
      },
      "shortcut-delete": {
        methods: ["default.shortcutDelete"]
      },
      "shortcut-select-all": {
        methods: ["default.shortcutSelectAll"]
      }
    },
    shortcuts: [
      { message: "shortcut-undo", win: "ctrl+z", mac: "cmd+z", when: "PanelName === 'sprite-editor'" },
      { message: "shortcut-redo", win: "ctrl+shift+z", mac: "cmd+shift+z", when: "PanelName === 'sprite-editor'" },
      { message: "shortcut-redo", win: "ctrl+y", mac: "cmd+y", when: "PanelName === 'sprite-editor'" },
      { message: "shortcut-apply", win: "ctrl+s", mac: "cmd+s", when: "PanelName === 'sprite-editor'" },
      { message: "shortcut-delete", win: "delete", mac: "delete", when: "PanelName === 'sprite-editor'" },
      { message: "shortcut-delete", win: "backspace", mac: "backspace", when: "PanelName === 'sprite-editor'" },
      { message: "shortcut-select-all", win: "ctrl+a", mac: "cmd+a", when: "PanelName === 'sprite-editor'" }
    ],
    assets: {
      menu: {
        methods: "./dist/assets-menu.js",
        assetMenu: "onAssetMenu"
      }
    },
    "asset-db": {
      mount: {
        path: "./assets",
        readonly: !1
      }
    }
  }
};

// source/main.ts
var pending = null, methods = {
  openPanel() {
    Editor.Panel.open(package_default.name);
  },
  /** Open the Sprite Editor on an image / atlas asset (uuid). */
  async editAsset(uuid) {
    uuid && (pending = uuid, await Editor.Panel.open(package_default.name), Editor.Message.send(package_default.name, "panel-load-asset", uuid));
  },
  takePending() {
    let uuid = pending;
    return pending = null, uuid;
  }
};
function load() {
}
function unload() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  load,
  methods,
  unload
});
//# sourceMappingURL=main.js.map
