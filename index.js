'use strict';

module.exports = {
  name: require('./package').name,

  init() {
    this._super.init && this._super.init.apply(this, arguments);

    this._templateDeprecations = [];
  },

  _shouldInclude() {
    // the presence of `this.app.tests` shows that we are in one of:
    //
    // * running non-production build
    // * running tests against production
    //
    var app = this.app || this._findHost();
    return app.tests;
  },

  included() {
    // From https://github.com/rwjblue/ember-debug-handlers-polyfill/blob/master/index.js
    var app = this.app || this._findHost();

    if (this._shouldInclude()) {
      app.import(
        'vendor/ember-cli-deprecation-workflow/deprecation-workflow.js'
      );
    }
  },

  treeForVendor(tree) {
    var root = process.env._DUMMY_CONFIG_ROOT_PATH || this.project.root;
    var configDir = '/config';

    if (
      this.project.pkg['ember-addon'] &&
      this.project.pkg['ember-addon']['configPath']
    ) {
      configDir = '/' + this.project.pkg['ember-addon']['configPath'];
    }

    var mergeTrees = require('broccoli-merge-trees');
    var Funnel = require('broccoli-funnel');
    var configTree = new Funnel(root + configDir, {
      include: ['deprecation-workflow.js'],

      destDir: 'ember-cli-deprecation-workflow',
    });

    return mergeTrees([tree, configTree], { overwrite: true });
  },

  _findHtmlbarsPreprocessor(registry) {
    var plugins = registry.load('template');

    return plugins.filter(function (plugin) {
      return plugin.name === 'ember-cli-htmlbars';
    })[0];
  },

  _monkeyPatch_EmberDeprecate(htmlbarsCompilerPreprocessor) {
    if (!htmlbarsCompilerPreprocessor._addon) {
      // not a new enough ember-cli-htmlbars to monkey patch
      // we need 1.0.3
      return;
    }
    var addonContext = this;
    var originalHtmlbarsOptions =
      htmlbarsCompilerPreprocessor._addon.htmlbarsOptions;
    var logToNodeConsole = this.project.config(
      process.env.EMBER_ENV
    ).logTemplateLintToConsole;

    htmlbarsCompilerPreprocessor._addon.htmlbarsOptions = function () {
      var options = originalHtmlbarsOptions.apply(this, arguments);
      var Ember = options.templateCompiler._Ember;

      if (Ember.Debug && Ember.Debug.registerDeprecationHandler) {
        Ember.Debug.registerDeprecationHandler(function (
          message,
          options,
          next
        ) {
          addonContext._templateDeprecations.push({
            message: JSON.stringify(message),
            test: false,
            options: JSON.stringify(options),
          });

          if (logToNodeConsole) {
            next();
          }
        });
      }

      var originalDeprecate = options.templateCompiler._Ember.deprecate;
      Ember.deprecate = function (message, test, options) {
        var noDeprecation;

        if (typeof test === 'function') {
          noDeprecation = test();
        } else {
          noDeprecation = test;
        }

        if (!noDeprecation) {
          addonContext._templateDeprecations.push({
            message: JSON.stringify(message),
            test: !!test,
            options: JSON.stringify(options),
          });
        }

        if (logToNodeConsole) {
          return originalDeprecate.apply(this, arguments);
        }
      };

      return options;
    };
  },

  setupPreprocessorRegistry(type, registry) {
    if (type === 'parent') {
      var htmlbarsCompilerPreprocessor =
        this._findHtmlbarsPreprocessor(registry);

      this._monkeyPatch_EmberDeprecate(htmlbarsCompilerPreprocessor);
    }
  },

  lintTree(type, tree) {
    if (type === 'template') {
      var TemplateLinter = require('./generate-deprecations-tree');

      return new TemplateLinter(this, tree);
    }
  },
};
