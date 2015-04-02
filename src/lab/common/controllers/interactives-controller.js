/*global define, $, setTimeout, document, window */

define(function (require) {
  // Dependencies.
                                require('seedrandom');
  var labConfig               = require('lab.config'),
      arrays                  = require('arrays'),
      FastClick               = require('fastclick'),
      _                       = require('underscore'),
      alert                   = require('common/alert'),
      validator               = require('common/validator'),
      getI18n                 = require('common/i18n'),
      metadata                = require('common/controllers/interactive-metadata'),
      languageSelect          = require('common/controllers/language-select'),
      DataSet                 = require('common/controllers/data-set'),
      BarGraphController      = require('common/controllers/bar-graph-controller'),
      GraphController         = require('common/controllers/graph-controller'),
      ExportController        = require('common/controllers/export-controller'),
      ScriptingAPI            = require('common/controllers/scripting-api'),
      ButtonController        = require('common/controllers/button-controller'),
      CheckboxController      = require('common/controllers/checkbox-controller'),
      TextController          = require('common/controllers/text-controller'),
      ImageController         = require('common/controllers/image-controller'),
      RadioController         = require('common/controllers/radio-controller'),
      SliderController        = require('common/controllers/slider-controller'),
      PulldownController      = require('common/controllers/pulldown-controller'),
      NumericOutputController = require('common/controllers/numeric-output-controller'),
      TableController         = require('common/controllers/table-controller'),
      ParentMessageAPI        = require('common/controllers/parent-message-api'),
      ThermometerController   = require('common/controllers/thermometer-controller'),
      PlaybackController      = require('common/controllers/playback-controller'),
      DivController           = require('common/controllers/div-controller'),
      DispatchSupport         = require('common/dispatch-support'),
      HelpSystem              = require('common/controllers/help-system'),
      tooltip                 = require('common/views/tooltip'),
      cookies                 = require('common/cookies'),

      // Helper function which just provides banner definition.
      setupBanner             = require('common/controllers/setup-banner'),
      AboutDialog             = require('common/controllers/about-dialog'),
      ShareDialog             = require('common/controllers/share-dialog'),
      CreditsDialog           = require('common/controllers/credits-dialog'),
      SemanticLayout          = require('common/layout/semantic-layout'),
      templates               = require('common/layout/templates'),

      ModelControllerFor = {
        'md2d':             require('models/md2d/controllers/controller'),
        'signal-generator': require('models/signal-generator/controller'),
        'iframe-model':     require('models/iframe/controller'),
        'sensor':           require('models/sensor/controller'),
        'dual-sensor':      require('models/dual-sensor/controller'),
        'dual-sensor-connector': require('models/dual-sensor-connector/controller'),
        'sensor-connector': require('models/sensor-connector/controller'),
        'labquest2':        require('models/labquest2/controller'),
        'energy2d':         require('models/energy2d/controllers/controller')
      },

      ExperimentController = require('common/controllers/experiment-controller'),

      // Set of available components.
      // - Key defines 'type', which is used in the interactive JSON.
      // - Value is a constructor function of the given component.
      // Each constructor should assume that it will be called with
      // following arguments:
      // 1. component definition (unmodified object from the interactive JSON),
      // 2. scripting API object,
      // 3. public API of the InteractiveController.
      // Of course, some of them can be passed unnecessarily, but
      // the InteractiveController follows this convention.
      //
      // The instantiated component should provide following interface:
      // # serialize()           - function returning a JSON object, which represents current state
      //                           of the component. When component doesn't change its state,
      //                           it should just return a copy (!) of the initial component definition.
      // # getViewContainer()    - function returning a jQuery object containing
      //                           DOM elements of the component.
      // # modelLoadedCallback(model) - optional function with , a callback which is called when the model is loaded.
      // # resize()              - optional function taking no arguments, a callback
      //                           which is called by the layout algorithm when component's container
      //                           dimensions are changed. This lets component to adjust itself to the
      //                           new container dimensions.
      //
      // Note that each components view container (so, jQuery object returned by getViewContainer() has to
      // have class 'component'! It's required and checked in the runtime by the interactive controller.
      // It ensures good practices while implementing new components.
      // Please see: src/sass/lab/_interactive-component.sass to check what this CSS class defines.
      ComponentConstructor = {
        'text':          TextController,
        'image':         ImageController,
        'button':        ButtonController,
        'checkbox':      CheckboxController,
        'pulldown':      PulldownController,
        'radio':         RadioController,
        'thermometer':   ThermometerController,
        'barGraph':      BarGraphController,
        'graph':         GraphController,
        'slider':        SliderController,
        'numericOutput': NumericOutputController,
        'table':         TableController,
        'div':           DivController,
        'playback':      PlaybackController
      };

  function clone(obj) {
    var copy;
    // Handle the 3 simple types, and null or undefined.
    if (null == obj || "object" !== typeof obj) return obj;
    // Handle Date
    if (obj instanceof Date) {
        copy = new Date();
        copy.setTime(obj.getTime());
        return copy;
    }
    // Handle Array
    if (obj instanceof Array) {
        copy = [];
        for (var i = 0, len = obj.length; i < len; i++) {
            copy[i] = clone(obj[i]);
        }
        return copy;
    }
    // Handle Object
    if (obj instanceof Object) {
        copy = {};
        for (var attr in obj) {
            if (obj.hasOwnProperty(attr)) copy[attr] = clone(obj[attr]);
        }
        return copy;
    }
    throw new Error("Unable to copy obj! Its type isn't supported.");
  }

  return function InteractivesController(interactiveReference, viewSelector) {

    var interactive = {},
        controller = {},
        initialInteractiveConfig,
        initialModelConfig,
        experimentController,
        experimentDefinition,
        modelController,
        model,
        currentModelID,
        $interactiveContainer,
        $fastClickContainer,
        helpSystem,
        i18n,
        modelDefinitions = [],
        modelHash = {},
        componentModelLoadedCallbacks,
        dataSetModelLoadedCallbacks,
        willResetModelCallbacks = [],
        ignoreModelResetEvent = false,
        initialModelLoad,

        // Hash of instantiated components.
        // Key   - component ID.
        // Value - array of component instances.
        componentByID = {},

        // Simple list of instantiated components.
        componentList = [],

        // List of properties that are bound to components and should be retained during
        // model reload / reset.
        propertiesRetainedByComponents = [],

        // Hash containing all public (see .addDataSet() method) data sets.
        publicDataSetsByName,

        // API for scripts defined in the interactive JSON file.
        // and additional model-specific scripting api if one is defined
        scriptingAPI,

        // Handles exporting data to DataGames, if 'exports' are specified.
        exportController,

        // Doesn't currently have any public methods, but probably will.
        parentMessageAPI,

        // Dialogs which can be shown using banner.
        aboutDialog,
        shareDialog,
        creditsDialog,

        semanticLayout,
        getNextTabIndex,
        randSeed,

        dispatch = new DispatchSupport("modelLoaded", "interactiveRendered", "modelReset", "resize",
                                       "interactiveRequested");

    // simple tabindex support, also exposed via api.getNextTabIndex()
    getNextTabIndex = function () {
      var tabIndex = -1;
      return function() {
        return tabIndex++;
      };
    };

    // Use seedrandom library (see vendor/seedrandom) that substitutes an explicitly seeded
    // RC4-based algorithm for Math.random().
    function generateRandomSeed() {
      randSeed = interactive.randomSeed;
      if (randSeed === undefined) {
        // Generate random seed.
        // First ensure that random is random for sure (seedrandom with explicit value could be
        // called during previous interactive load, before model tick etc).
        Math.seedrandom();
        randSeed = Math.random().toString();
      }
      Math.seedrandom(randSeed);
    }

    function getModelDefinition(id) {
      if (modelHash[id]) {
        return modelHash[id];
      }
      throw new Error("No model found with id " + id);
    }

    function layoutInteractive() {
      // Do nothing if this is called before the model loads (for example via a resize event).
      // The interactive will be laid out as soon as the model loads anyway, and furthermore the
      // semantic layout mechanism calls at least one modelController method.
      if (!semanticLayout.isReady()) {
        return;
      }
      semanticLayout.layoutInteractive();
    }

    // ------------------------------------------------------------
    //
    // Handle keyboard shortcuts for model operation.
    //
    // ------------------------------------------------------------

    function setupModelPlayerKeyboardHandler() {
      // Deregister previous keydown handlers. Use namespaces so the code
      // will not inadvertently remove event handlers attached by other code.
      $interactiveContainer.off('keydown.interactiveController');
      if (modelController && modelController.enableKeyboardHandlers()) {
        $interactiveContainer.on('keydown.interactiveController', function(event) {
          var keycode = event.keycode || event.which;
          switch(keycode) {
            case 13:                 // return
            event.preventDefault();
            scriptingAPI.api.start();
            break;

            case 32:                 // space
            event.preventDefault();
            if (!scriptingAPI.api.isStopped()) {
              scriptingAPI.api.stop();
            } else {
              scriptingAPI.api.start();
            }
            break;

            case 37:                 // left-arrow
            event.preventDefault();
            if (!scriptingAPI.api.isStopped()) {
              scriptingAPI.api.stop();
            } else {
              scriptingAPI.api.stepBack();
            }
            break;

            case 39:                 // right-arrow
            event.preventDefault();
            if (!scriptingAPI.api.isStopped()) {
              scriptingAPI.api.stop();
            } else {
              scriptingAPI.api.stepForward();
            }
            break;
          }
        });
        // $interactiveContainer.focus();
      }
    }

    function setupLayout() {
      var template, layout, comp, components, banner, resizeAfterFullscreen;

      if (typeof interactive.template === "string") {
        template = templates[interactive.template];
      } else {
        template = interactive.template;
      }

      // The authored definition of which components go in which container.
      layout = interactive.layout;

      // Banner hash containing components, layout containers and layout deinition
      // (components location). Keep it in a separate structure, because we do not
      // expect these objects to be serialized!
      banner = setupBanner(controller, interactive, creditsDialog, aboutDialog, shareDialog);
      // Register callbacks of banner components.
      components = banner.components;
      for (comp in components) {
        if (components.hasOwnProperty(comp)) {
          comp = components[comp];
          if (comp.modelLoadedCallback) {
            // $.proxy ensures that callback will be always executed
            // in the context of correct object ('this' binding).
            componentModelLoadedCallbacks.push($.proxy(comp.modelLoadedCallback, comp));
          }
        }
      }
      // Note that all of these operations create a new object.
      // So interactive definition specified by the author won't be affected.
      // This is important for serialization correctness.
      template = banner.template.concat(template);
      template.forEach(function (container, idx) {
        template[idx] = $.extend({}, container);
      });
      layout = $.extend({}, layout, banner.layout);
      components = $.extend({}, componentByID, banner.components);

      // Setup layout using both author components and components
      // created automatically in this controller.
      semanticLayout.initialize({
        $mainContainer: $interactiveContainer,
        $containersParent: $fastClickContainer,
        containers: template,
        layout: layout,
        components: components,
        aspectRatio: interactive.aspectRatio,
        fontScale: interactive.fontScale,
        padding: interactive.padding
      });

      // We are rendering in embeddable mode if only element on page
      // so resize when window resizes.
      if (onlyElementOnPage()) {
        $(window).off("resize.lab-resize-handler");
        $(window).on("resize.lab-resize-handler", function() {
          controller.resize();
        });
      }

      // in all cases, call resize when entering and existing fullscreen
      resizeAfterFullscreen = function() {
        // need to call twice, as safari requires two attempts before it has
        // the correct dimensions.
        controller.resize();
        setTimeout(controller.resize, 50);
      };
      $(document).off(".lab-fullscreen-change");
      $(document).on("fullscreenchange.lab-fullscreen-change", resizeAfterFullscreen)
                 .on("mozfullscreenchange.lab-fullscreen-change", resizeAfterFullscreen)
                 .on("webkitfullscreenchange.lab-fullscreen-change", resizeAfterFullscreen);
    }

    function createComponent(component) {
          // Get type and ID of the requested component from JSON definition.
      var type = component.type,
          id = component.id,
          comp;

      // Use an appropriate constructor function and create a new instance of the given type.
      // Note that we use constant set of parameters for every type:
      // 1. component definition (exact object from interactive JSON),
      // 2. scripting API object,
      // 3. public API of the InteractiveController.
      comp = new ComponentConstructor[type](component, controller);

      if (!comp.getViewContainer().hasClass("component")) {
        throw new Error("Invalid Interactive Component implementation. Each component has to have 'component' class.");
      }

      // Save the new instance.
      componentByID[id] = comp;
      componentList.push(comp);
      if (component.retainProperty && component.property != null) {
        // All properties that are bound to some interactive component should be retained during
        // model reset or reload.
        propertiesRetainedByComponents.push(component.property);
      }

      // Register component modelLoaded callbacks if available.
      // FIXME. These callbacks should be event listeners.
      if (comp.modelLoadedCallback) {
        // $.proxy ensures that callback will be always executed
        // in the context of correct object ('this' binding).
        componentModelLoadedCallbacks.push($.proxy(comp.modelLoadedCallback, comp));
      }
    }

    /**
      Generic function that accepts either a string or an array of strings,
      and returns the complete string
    */
    function getStringFromArray(str) {
      if (typeof str === 'string') {
        return str;
      }
      return str.join('\n');
    }

    /**
      Validates interactive definition.

      Displays meaningful info in case of any errors. Also an exception is being thrown.

      @param interactive
        hash representing the interactive specification
    */
    function validateInteractive(interactive) {
      var i, len, modelDefinitions, modelDefinition, components, errMsg;

      function validateArray(modelName, array) {
        var i, len, errMsg;
        // Support undefined / null values - just return.
        if (!array) return;

        try {
          for (i = 0, len = array.length; i < len; i++) {
            array[i] = validator.validateCompleteness(metadata[modelName], array[i]);
          }
        } catch (e) {
          errMsg = "Incorrect " + modelName +  " definition:\n" + e.message;
          alert(errMsg);
          throw new Error(errMsg);
        }
      }

      // Validate top level interactive properties.
      try {
        interactive = validator.validateCompleteness(metadata.interactive, interactive);
      } catch (e) {
        errMsg = "Incorrect interactive definition:\n" + e.message;
        alert(errMsg);
        throw new Error(errMsg);
      }

      validateArray("model", interactive.models);
      validateArray("parameter", interactive.parameters);
      validateArray("output", interactive.outputs);
      validateArray("dataSet", interactive.dataSets);
      validateArray("filteredOutput", interactive.filteredOutputs);
      validateArray("helpTip", interactive.helpTips);

      // Validate also nested structures.
      modelDefinitions = interactive.models;
      for (i = 0, len = modelDefinitions.length; i < len; i++) {
        modelDefinition = modelDefinitions[i];
        validateArray("parameter", modelDefinition.parameters);
        validateArray("output", modelDefinition.outputs);
        validateArray("filteredOutput", modelDefinition.filteredOutputs);
      }


      // If an experiment template exists validate nested experiment structures.
      if (interactive.experiment) {
        experimentDefinition = interactive.experiment;
        validator.validateCompleteness(metadata.experimentTimeSeries, experimentDefinition.timeSeries);
        validateArray("experimentParameter", experimentDefinition.parameters);
        validateArray("experimentDestination", experimentDefinition.destinations);
        validateArray("experimentSavedRun", experimentDefinition.savedRuns);
      }

      components = interactive.components;
      try {
        for (i = 0, len = components.length; i < len; i++) {
          components[i] = validator.validateCompleteness(metadata[components[i].type], components[i]);
        }
      } catch (e) {
        errMsg = "Incorrect " + components[i].type + " component definition:\n" + e.message;
        alert(errMsg);
        throw new Error(errMsg);
      }

      // Validate exporter, if any...
      if (interactive.exports) {
        try {
          interactive.exports = validator.validateCompleteness(metadata.exports, interactive.exports);
        } catch (e) {
          errMsg = "Incorrect exports definition:\n" + e.message;
          alert(errMsg);
          throw new Error(errMsg);
        }
      }

      return interactive;
    }

    /**
      Is the Interactive the only element on the page?

      An Interactive can either be displayed as the only content on a page
      (often in an iframe) or in a dom element on a page with other elements.

      TODO: make more robust
      This function makes a simplifying assumption that the Interactive is the
      only content on the page if the parent is the <body> element
    */
    function onlyElementOnPage() {
      return $interactiveContainer.parent().prop("nodeName") === "BODY";
    }

    /**
      Setup theme (which is just a CSS class of the main interactive container).
     */
    function setupTheme() {
      var theme = interactive.theme;
      if (arrays.isArray(theme)) {
        // ["a", "b"] => "lab-theme-a lab-theme-b"
        theme = theme.map(function (el) { return 'lab-theme-'+el; }).join(' ');
      } else if (theme) {
        theme = 'lab-theme-' + theme;
      } else {
        theme = '';
      }
      $interactiveContainer.alterClass('lab-theme-*', theme);
    }

    /**
      The main method called when this controller is created.

      Populates the element pointed to by viewSelector with divs to contain the
      molecule container (view) and the various components specified in the interactive
      definition, and

      @param newInteractive
        hash representing the interactive specification
    */
    function loadInteractive(newInteractive) {
      // Cleanup container!
      $interactiveContainer.empty();

      // Attach FastClick only to the .lab-fastclick-container DIV. We don't want to affect rest of the
      // web page (e.g. by attaching FastClick to "body" or window), let its developer decide whether
      // FastClick should be used there or not. It solves two issues on mobile browsers:
      // - eliminates 300ms delay between a physical tap and the firing of a click event
      // - fixes sticky :hover state (https://www.pivotaltracker.com/story/show/58373748)
      //
      // Unfortunatelly we cannot attach FastClick to the whole interactive container, as it breaks
      // e.g. jQuery context menu.
      // See: https://www.pivotaltracker.com/story/show/63386470
      // Components have choice whether to attach themselves to .lab-interactive-container
      // or .lab-fastclick-container.
      $fastClickContainer = $('<div class="lab-fastclick-container">');
      $fastClickContainer.appendTo($interactiveContainer);
      FastClick.attach($fastClickContainer[0]);

      // We have to create a new container for dialogs. When jQuery UI dialog is open, it moves
      // all its sibling elements before itself (kind of z indexing). It means all the siblings
      // are removed from DOM and then added again. Besides performance it can cause unwanted
      // effects in some cases (e.g. iframe content is reloaded). Separate container that contains
      // only dialogs ensures that it won't happen.
      $fastClickContainer.append('<div class="lab-dialog-container">');

      // Each time we load a new interactive, we assume that it would be an "initial" model load.
      // This flag is used to decide whether parameters should be retained or not.
      // During the initial model load we obviously don't want to retain parameters.
      initialModelLoad = true;

      controller.interactive = newInteractive;

      // Save initial interactive config for reload method (so it can be synchronous).
      initialInteractiveConfig = $.extend(true, {}, controller.interactive);
      // Validate interactive.
      controller.interactive = validateInteractive(controller.interactive);
      interactive = controller.interactive;
      // Ensure that interactive initialization is always the same if it's desired
      // ("randomSeed" paramenter is provided).
      generateRandomSeed();
      // Setup CSS class of the main container.
      setupTheme();
      // Set up the list of possible modelDefinitions.
      modelDefinitions = interactive.models;
      for (var i = 0, len = modelDefinitions.length; i < len; i++) {
        modelHash[modelDefinitions[i].id] = modelDefinitions[i];
      }
      // Try to load the first model (in order) and initialize interactive.
      var firstModel = modelDefinitions[0];
      if (firstModel && firstModel.url) {
        // Model has to be downloaded, it's async operation so start with it.
        loadModel(firstModel.id);
        initializeInteractive();
      } else if (firstModel && firstModel.model) {
        // Model is provided inside Interactive JSON, so setup interactive first and then
        // load a model.
        initializeInteractive();
        loadModel(firstModel.id, firstModel.model);
      }
    }

    function cleanupInteractive() {
      // Clear component instances.
      componentList = [];
      componentByID = {};
      // Internal onLoad callbacks (TODO REFACTOR ME)
      dataSetModelLoadedCallbacks = [];
      componentModelLoadedCallbacks = [];
      // And list of properties bound to components.
      propertiesRetainedByComponents = [];
    }

    function initializeInteractive() {
      cleanupInteractive();

      i18n = getI18n(interactive.lang);
      // Setup menu that lets users change language of the interactive. Do it ASAP, as it involves
      // async download of interactive metadata.
      languageSelect('#lang-icon', controller);

      creditsDialog = new CreditsDialog(".lab-dialog-container", i18n);
      aboutDialog = new AboutDialog(".lab-dialog-container", i18n);
      shareDialog = new ShareDialog(".lab-dialog-container", viewSelector, i18n);

      var modelDef = controller.interactive.models[0];
      modelController = createModelController(modelDef.type, modelDef.modelUrl, null);
      // also be sure to get notified when the underlying model changes
      // (this catches reloads)
      modelController.on('modelReset', modelResetHandler);

      // Create Scripting API
      scriptingAPI = new ScriptingAPI(controller, null);
      // Extend universal Interactive scriptingAPI with optional model-specific scripting API
      if (modelController.ScriptingAPI) {
        scriptingAPI.extend(modelController.ScriptingAPI);
      }
      // Expose API to global namespace (prototyping / testing using the browser console).
      scriptingAPI.exposeScriptingAPI();

      // Setup data sets.
      publicDataSetsByName = {};
      interactive.dataSets.forEach(function (dataSetDefinition) {
        // Data set will automatically register itself in interactive controller (it will call
        // .addDataSet() method).
        new DataSet(dataSetDefinition, controller);
      });

      // Setup help system if help tips are defined.
      if (interactive.helpTips.length > 0) {
        helpSystem = new HelpSystem(interactive.helpTips, $fastClickContainer);
        controller.on("interactiveRendered.helpSystem", function () {
          // Make sure that this callback is executed only once.
          controller.on("interactiveRendered.helpSystem", null);

          function hashCode(string) {
            var hash = 0, len = string.length, i, c;
            if (len === 0) return hash;
            for (i = 0; i < len; i++) {
              c = string.charCodeAt(i);
              hash = ((hash<<5) - hash) + c;
              hash = hash & hash;
            }
            return hash;
          }
          var hash = hashCode(JSON.stringify(interactive));
          // When displayOnLoad is set to true, the help mode will be automatically shown,
          // but only when user opens interactive for the first time.
          if (interactive.helpOnLoad && !cookies.hasItem("lab-help-" + hash)) {
            helpSystem.start();
            cookies.setItem("lab-help-" + hash, true);
          }
        });
      }

      // Replace native tooltips with custom, styled and responsive tooltips.
      tooltip($interactiveContainer);

      // Create interactive components
      var componentJsons = controller.interactive.components || [];

      for (var i = 0, len = componentJsons.length; i < len; i++) {
        createComponent(componentJsons[i]);
      }

      // Setup messaging with CODAP (or other data manager) if present

      // WARNING: due to deficiencies in iframePhone (as of iframePhone 1.1), this must take
      // place in the same event loop as the creation of parentMessageAPI (otherwise, the
      // codap-present message may be swallowed by parentMessageAPI's iframePhone instance, with the
      // result that exportController.canExportData never becomes true)

      exportController = new ExportController(controller);

      // Setup experimentController, if defined.
      if (interactive.experiment) {
        experimentController = new ExperimentController(interactive.experiment, controller);
      }

      // When all components are created, we can initialize semantic layout.
      setupLayout();
    }

    function createModelController(type, modelUrl, modelOptions) {
      // set default model type to "md2d"
      var modelType = type || "md2d";
      var modelController;

      if (ModelControllerFor[modelType] === null) {
        throw new Error("Couldn't understand modelType '" + modelType + "'!");
      }

      modelController = new ModelControllerFor[modelType](modelUrl, modelOptions, controller);

      return modelController;
    }

    /**
      Load the model from the model definitions hash.

      @param: currentModelID.
      @optionalParam modelObject
      @optionalParam additionalPropertiesToRetain properties that should be retained during load
                     process except from ones defined in 'propertiesToRetain' interactive section
      @optionalParam cause cause of the load (can be load, reload or custom)
    */
    function loadModel(id, modelConfig, additionalPropertiesToRetain, cause) {
      var modelDefinition = getModelDefinition(id),
          interactiveViewOptions,
          interactiveModelOptions,
          retainedProperties;

      // Ensure that model load is always the same if it's desired ("randomSeed" parameter
      // is provided).
      generateRandomSeed();

      // Check initialModelLoad flag. If it's equal to false, it means that it's a subsequent model
      // load and properties really can be retained.
      if (!initialModelLoad) {
        retainedProperties = getRetainedProperties(additionalPropertiesToRetain);
      }

      currentModelID = id;
      controller.currentModel = modelDefinition;

      if (modelDefinition.viewOptions) {
        // Make a deep copy of modelDefinition.viewOptions, so we can freely mutate interactiveViewOptions
        // without the results being serialized or displayed in the interactives editor.
        interactiveViewOptions = $.extend(true, {}, modelDefinition.viewOptions);
      } else {
        interactiveViewOptions = { controlButtons: 'play' };
      }

      if (modelDefinition.modelOptions) {
        // Make a deep copy of modelDefinition.modelOptions.
        interactiveModelOptions = $.extend(true, {}, modelDefinition.modelOptions);
      }

      // Load provided modelConfig (highest priority), model definition placed directly inside
      // interactive JSON or model defined by URL.
      if (modelConfig) {
        finishWithLoadedModel(modelDefinition.url, modelConfig, retainedProperties, cause);
      } else if (modelDefinition.model) {
        finishWithLoadedModel(modelDefinition.url, modelDefinition.model, retainedProperties, cause);
      } else if (modelDefinition.url) {
        $.get(labConfig.modelsRootUrl + modelDefinition.url).done(function(modelConfig) {
          // Deal with the servers that return the json as text/plain
          modelConfig = typeof modelConfig === 'string' ? JSON.parse(modelConfig) : modelConfig;
          finishWithLoadedModel(modelDefinition.url, modelConfig, retainedProperties, cause);
        }).fail(function() {
          modelConfig = {
            "type": "md2d",
            "width": 2.5,
            "height": 1.5,
            "viewOptions": {
              "backgroundColor": "rgba(245,200,200,255)",
              "showClock": false,
              "textBoxes": [
                {
                  "text": "Model could not be loaded:",
                  "x": 0.0,
                  "y": 1.0,
                  "width": 2.5,
                  "height": 0.25,
                  "fontScale": 1.4,
                  "layer": 1,
                  "frame": "rectangle",
                  "textAlign": "center",
                  "strokeOpacity": 0,
                  "backgroundColor": "rgb(232,231,231)"
                },
                {
                  "text": modelDefinition.url,
                  "x": 0.0,
                  "y": 0.8,
                  "width": 2.5,
                  "height": 0.25,
                  "fontScale": 0.9,
                  "layer": 1,
                  "frame": "rectangle",
                  "textAlign": "center",
                  "strokeOpacity": 0,
                  "backgroundColor": "rgb(232,231,231)"
                }
              ]
            }
          };
          finishWithLoadedModel(modelDefinition.url, modelConfig, retainedProperties, cause);
        });
      }

      function processOptions(modelConfig, interactiveModelConfig, interactiveViewConfig) {
        var modelOptions,
            viewOptions;

        function meldOptions (base, overlay) {
          var p;
          for(p in base) {
            if (overlay[p] === undefined) {
              if (arrays.isArray(base[p])) {
                // Array.
                overlay[p] = $.extend(true, [], base[p]);
              } else if (typeof base[p] === "object") {
                // Object.
                overlay[p] = $.extend(true, {}, base[p]);
              } else {
                // Basic type.
                overlay[p] = base[p];
              }
            } else if (typeof overlay[p] === "object" && !(overlay[p] instanceof Array)) {
              overlay[p] = meldOptions(base[p], overlay[p]);
            } else if (overlay[p] instanceof Array && base[p] instanceof Array) {
              overlay[p] = $.extend(true, base[p], overlay[p]);
            }
          }
          return overlay;
        }

        // 1. Process view options.
        // Do not modify initial configuration.
        viewOptions = $.extend(true, {}, interactiveViewConfig);
        // Merge view options defined in interactive (interactiveViewConfig)
        // with view options defined in the basic model description.
        viewOptions = meldOptions(modelConfig.viewOptions || {}, viewOptions);

        // 2. Process model options.
        // Do not modify initial configuration.
        modelOptions = $.extend(true, {}, interactiveModelConfig);
        // Merge model options defined in interactive (interactiveModelConfig)
        // with the basic model description.
        modelOptions = meldOptions(modelConfig || {}, modelOptions);

        // Update view options in the basic model description after merge.
        // Note that many unnecessary options can be passed to Model constructor
        // because of that (e.g. view-only options defined in the interactive).
        // However, all options which are unknown for Model will be discarded
        // during options validation, so this is not a problem
        // (but significantly simplifies configuration).
        modelOptions.viewOptions = viewOptions;

        return modelOptions;
      }

      function finishWithLoadedModel(modelUrl, modelConfig, retainedProperties, cause) {
        // Save initial model config for reload method (so it can be synchronous).
        initialModelConfig = $.extend(true, {}, modelConfig);

        var modelOptions = processOptions(modelConfig, interactiveModelOptions, interactiveViewOptions);
        var possiblySetButtonStyle;

        if (modelController) {
          modelController.reload(modelUrl, modelOptions, true);
        } else {
          throw new Error("REF something went wrong");
        }

        model = modelController.model;

        setupModelPlayerKeyboardHandler();

        // Update model references in various objects.
        scriptingAPI.bindModel(model);
        // FIXME: this doesn't seem like a necessary step. However, without it md2d-scripting-api
        // tests fail, but only when all tests are run (e.g. make test-src)! When you run just this
        // single test everything works (e.g. mocha test/md2d/md2d-scripting-api). It looks like
        // window.script variable references some old API instance and seems to be related to the
        // test environment setup. Temporarily put this call here for safety.
        scriptingAPI.exposeScriptingAPI();
        parentMessageAPI.bindModel(model);

        initializeModelOutputsAndParameters();

        if (retainedProperties) {
          model.set(retainedProperties);
        }

        for (var i = 0; i < dataSetModelLoadedCallbacks.length; i++) {
          dataSetModelLoadedCallbacks[i]();
        }

        // We call component loaded callbacks before onLoad scripts because some onLoad scripts
        // may require that components are already initialized.
        for (i = 0; i < componentModelLoadedCallbacks.length; i++) {
          componentModelLoadedCallbacks[i](model, scriptingAPI);
        }

        var onLoadScript = null;
        if (controller.currentModel.onLoad) {
          onLoadScript = scriptingAPI.makeFunctionInScriptContext(getStringFromArray(controller.currentModel.onLoad));
          onLoadScript();
        }

        if (experimentController) {
          experimentController.setOnLoadScript(onLoadScript);
        }

        // Setup exporter. Has to happen before modelLoaded. Time-based dependencies FTW.
        exportController.init(interactive.exports || getDefaultExports());

        exportController.on('canExportData.interactivesController', function() {
          // hacky, but this updates the 'actualUseDuration' output which depends on canExportData
          modelController.model.makeInvalidatingChange();
        });

        if (exportController.modelCanExportData()) {
          modelController.model.properties.controlButtonStyle = 'codap';
        }

        exportController.on('modelCanExportData.interactivesController', function() {
          modelController.model.properties.controlButtonStyle = 'codap';
        });

        dispatch.modelLoaded(cause || "initialLoad");

        // Call .ready *after* all previous operations. Note that it will trigger e.g. tick
        // history push of an initial state. It should include all modifications applied
        // by on load scripts and callbacks.
        if (model.ready) model.ready();

        // This will attach model container to DOM.
        semanticLayout.setupModel(modelController);
        layoutInteractive();

        modelController.initializeView();

        dispatch.interactiveRendered();

        // Each subsequent model won't be treated as initial one so e.g. properties can be retained.
        initialModelLoad = false;
      }
    }

    function initializeModelOutputsAndParameters() {
      setupCustomOutputs("basic", controller.currentModel.outputs, interactive.outputs);
      setupCustomParameters(controller.currentModel.parameters, interactive.parameters);
      // Setup filtered outputs after basic outputs and parameters, as filtered output require its input
      // to exist during its definition.
      setupCustomOutputs("filtered", controller.currentModel.filteredOutputs, interactive.filteredOutputs);
    }

    function modelResetHandler(cause) {
      if ( !ignoreModelResetEvent ) {
        notifyModelResetCallbacks(cause);
      }
    }

    /**
      Notify observers that a model was reset, passing along the cause of the reset event.
    */
    function notifyModelResetCallbacks(cause) {
      dispatch.modelReset(cause);
    }

    /**
      Notify observers that a reset event is pending for a given model, passing them the model that
      will be reset and a reset-request object that is unique for each observer.

      If any observers return true, the reset operation will be paused. They can cache the reset
      request object and asynchronously indicate that it is ok to proceed with the reset by calling
      the cached object's 'proceed' or 'cancel' method.

      Once the a reset request's 'proceed' method has been called, calling its 'cancel' method has
      no effect, and vice versa.

      If any observers that returned true fail to later call either method of the reset request,
      then the reset will be put off indefinitely.

      (Note that, for the time being, there is no practical difference between canceling a reset and
      putting it off indefintely. However, almost surely we will want to keep track of whether
      reset has been canceled or not, so that we can block subsequent requests to reset the model,
      give UI feedback, etc.)

      If no observers return a truthy value--and also do not call their reset request's 'cancel'
      method during their execution--then the reset will take place synchronously.

      Note that observers that do not return a truthy value are treated like observers that call the
      'proceed' method: subsequently calling the 'cancel' method of their reset request will have no
      effect.
    */
    function notifyWillResetModelAnd(closure) {

      // Fast path; also required because no callbacks => we never call resetRequest.proceed()
      if (willResetModelCallbacks.length === 0) {
        closure();
      }

      var numberOfResponsesRequired = willResetModelCallbacks.length;
      var numberOfProceedResponses = 0;
      var resetWasCanceled = false;

      function proceedIfReady() {
        if (!resetWasCanceled && numberOfProceedResponses === numberOfResponsesRequired) {
          closure();
        }
      }

      // Returns a new "use once" object that the willResetModel callback can use to asynchronously
      // allow the reset to proceed or cancel.
      function makeResetRequest() {
        var wasUsed = false;

        return {
          proceed: function() {
            if (wasUsed) {
              return;
            }
            wasUsed = true;
            numberOfProceedResponses++;
            proceedIfReady();
          },

          cancel: function() {
            if (wasUsed) {
              return;
            }
            wasUsed = true;
            resetWasCanceled = true;
          }
        };
      }

      willResetModelCallbacks.forEach(function(willResetModelCallback) {
        var resetRequest = makeResetRequest();

        // willResetModel callbacks that don't return a value (or return a falsy value) without
        // having invoked resetRequest.cancel() should be treated as having requested to proceed.
        if (!willResetModelCallback(model, resetRequest)) {
          // remember this has no effect if the callback already called resetRequest.cancel():
          resetRequest.proceed();
        }
      });
    }

    /**
      After a model loads, this method sets up the custom output properties specified in the "model"
      section of the interactive and in the interactive.

      Any output property definitions in the model section of the interactive specification override
      properties with the same that are specified in the main body if the interactive specification.

      @outputType - accept two values "basic" and "filtered", as this function can be used for processing
        both types of outputs.
    */
    function setupCustomOutputs(outputType, modelOutputs, interactiveOutputs) {
      if (!modelOutputs && !interactiveOutputs) return;

      var outputs = {},
          prop,
          output;

      function processOutputsArray(outputsArray) {
        if (!outputsArray) return;
        for (var i = 0; i < outputsArray.length; i++) {
          outputs[outputsArray[i].name] = outputsArray[i];
        }
      }

      // per-model output definitions override output definitions from interactives
      processOutputsArray(interactiveOutputs);
      processOutputsArray(modelOutputs);

      for (prop in outputs) {
        if (outputs.hasOwnProperty(prop)) {
          output = outputs[prop];
          // DOM elements (and, by analogy, Next Gen MW interactive components like slides)
          // have "ids". But, in English, properties have "names", but not "ids".
          switch (outputType) {
            case "basic":
              model.defineOutput(output.name, {
                label: output.label,
                unitType: output.unitType,
                unitName: output.unitName,
                unitPluralName: output.unitPluralName,
                unitAbbreviation: output.unitAbbreviation
              }, scriptingAPI.makeFunctionInScriptContext(getStringFromArray(output.value)));
              break;
            case "filtered":
              model.defineFilteredOutput(output.name, {
                label: output.label,
                unitType: output.unitType,
                unitName: output.unitName,
                unitPluralName: output.unitPluralName,
                unitAbbreviation: output.unitAbbreviation
              }, output.property, output.type, output.period);
              break;
          }
        }
      }
    }

    /**
      After a model loads, this method is used to set up the custom parameters specified in the
      model section of the interactive, or in the toplevel of the interactive
    */
    function setupCustomParameters(modelParameters, interactiveParameters) {
      if (!modelParameters && !interactiveParameters) return;

      var initialValues = {},
          customParameters,
          i, parameter, onChangeFunc;

      // append modelParameters second so they're processed later (and override entries of the
      // same name in interactiveParameters)
      customParameters = (interactiveParameters || []).concat(modelParameters || []);

      for (i = 0; i < customParameters.length; i++) {
        parameter = customParameters[i];
        // onChange callback is optional.
        onChangeFunc = undefined;
        if (parameter.onChange) {
          onChangeFunc = scriptingAPI.makeFunctionInScriptContext('value', getStringFromArray(parameter.onChange));
        }
        // Define parameter using modeler.
        model.defineParameter(parameter.name, {
          label: parameter.label,
          unitType: parameter.unitType,
          unitName: parameter.unitName,
          unitPluralName: parameter.unitPluralName,
          unitAbbreviation: parameter.unitAbbreviation
        }, onChangeFunc);

        if (parameter.initialValue !== undefined) {
          // Deep copy of the initial value. Otherwise, if initial value is an object or array,
          // all updates to parameter value will be shared with its initial value.
          initialValues[parameter.name] = clone(parameter.initialValue);
        }
      }

      model.set(initialValues);
    }

    function getRetainedProperties(additionalProps) {
      var propertiesToRetain;

      if ( interactive.propertiesToRetain ) {
        // interactive specifies properties to retain; use them
        propertiesToRetain = interactive.propertiesToRetain;
      } else if (exportController.canExportData()) {
        // We're in CODAP (or something similar) and interactive is not explicit about which
        // properties to retain; start with a default list of properties
        propertiesToRetain = getDefaultPropertiesToRetain();
      }

      // retain duration-related properties if they are defined
      var durationProps = ['useDuration', 'requestedDuration'].filter(function(key) {
        return model.properties[key] !== undefined;
      });
      additionalProps = (additionalProps || []).concat(durationProps);

      // Also retain properties bound to components that specify retainProperty: true, and any
      // properties in additionalProps (which come from the optional parameter to resetModel and
      // loadModel in the interactive scripting API)
      var propertyKeys = _.uniq(_.flatten([
        propertiesToRetain, propertiesRetainedByComponents, additionalProps || []
      ])).filter(isPropertyWritable);

      var properties = {};

      propertyKeys.forEach(function(key) {
        properties[key] = model.properties[key];
      });

      return properties;
    }

    function getBoundProperties() {
      var componentProperties = _.pluck(interactive.components, 'property');
      var graphProperties = _.pluck(_.where(interactive.components, { type: 'graph' }), 'properties');

      return _.without(_.uniq(_.flatten([componentProperties, graphProperties])), undefined);
    }

    function isPropertyWritable(name) {
      return !!model && !!model.isPropertyWritable && model.isPropertyWritable(name);
    }

    function getDefaultExports() {
      // start with a list of all properties bound to components
      var boundProperties = getBoundProperties();
      var additionalPerTickProperties = [];

      // assume that writable properties are experimental parameters; log them once per run
      var perRunProperties = boundProperties.filter(isPropertyWritable);

      // assume that read-only properties change due to model physics; log them at every tick
      var perTickProperties = _.difference(boundProperties, perRunProperties);

      // As a special case, MD2D models should log kinetic and potential energy (and if we are in
      // the molecular size scale, also temperature)

      if (model && model.properties.type === 'md2d') {
        additionalPerTickProperties =
          model.properties.unitsScheme === 'md2d' ?
            ['kineticEnergy', 'potentialEnergy', 'temperature'] :
            ['kineticEnergy', 'potentialEnergy'];
      }

      perTickProperties = _.uniq(perTickProperties.concat(additionalPerTickProperties));

      return {
        perRun: perRunProperties,
        perTick: perTickProperties
      };
    }

    function getDefaultPropertiesToRetain() {
      var boundProperties = getBoundProperties();
      var writableProperties = boundProperties.filter(isPropertyWritable);

      return writableProperties;
    }

    //
    // Public API.
    //
    controller = {
      get interactiveContainer() {
        // Note that by default fastclick container is returned here. It's interactive container
        // child with FastClick attached.
        // Some elements may want to attach themselves to interactive container itself when they
        // don't work well with FastClick (e.g. jQuery Context Menu).
        return $fastClickContainer;
      },
      get scriptingAPI() {
        return scriptingAPI;
      },
      get helpSystem() {
        return helpSystem;
      },
      get i18n() {
        return i18n;
      },
      get modelController() {
        return modelController;
      },
      get randomSeed() {
        return randSeed;
      },
      get exportController() {
        return exportController;
      },
      get defaultExports() {
        return getDefaultExports();
      },
      get propertiesToRetain() {
        return getRetainedProperties();
      },
      get fontFamily() {
        return $interactiveContainer.css('font-family');
      },

      /**
        Return the model object. Note this is provided behind a method because we eventually
        want to support multiple model objects accesible by id.
      */
      getModel: function() {
        return model;
      },

      /**
        Return public data set (e.g. defined in interactive JSON).
       */
      getDataSet: function(name) {
        return publicDataSetsByName[name];
      },

      /*
        Add a new data set.
        If data set is 'private', it won't be accessible via .getDataSet() method and it won't be
        serialized as a part of interactive JSON.
       */
      addDataSet: function (dataSet, private) {
        // $.proxy ensures that callback will be always executed
        // in the context of correct object ('this' binding).
        dataSetModelLoadedCallbacks.push($.proxy(dataSet.modelLoadedCallback, dataSet));
        if (!private) {
          publicDataSetsByName[dataSet.name] = dataSet;
        }
      },

      getScriptingAPI: function() {
        return scriptingAPI;
      },

      getModelController: function () {
        return modelController;
      },

      getComponent: function (id) {
        return componentByID[id];
      },

      getNextTabIndex: getNextTabIndex,

      /**
       * Loads a new interactive. It accepts an object (hash) representing interactive definition.
       * @param {object} newInteractive   new interactive definition
       */
      loadInteractive: loadInteractive,

      /**
       * Emits "interactiveRequested" event that should be handled by the embedding page.
       * It provides a new URL at which interactive is available.
       * @param {string} url              new interactive URL
       */
      requestInteractiveAt: function (url) {
        dispatch.interactiveRequested(url);
      },

      reloadInteractive: function() {
        model.stop();
        notifyWillResetModelAnd(function() {
          controller.loadInteractive(initialInteractiveConfig);
        });
      },

      loadModel: loadModel,

      /**
       * Reload the model. The interactives controller will emit a 'willResetModel'.
       * The willResetModel observers can ask to wait for asynchronous confirmation before the model
       * is actually reset; see the notifyWillResetModelAnd function.
       * @param  {object} options hash of options, supported properties:
       *                         * propertiesToRetain - a list of properties to save before
       *                           the model reload and restore after reload.
       *                         * cause - cause of the reload action, it can be e.g. "reload"
       *                           or "new-run". It will be passed to "modelLoaded" event handlers.
       */
      reloadModel: function(options) {
        if (!options) options = {};
        if (!options.cause) options.cause = "reload";

        model.stop();
        notifyWillResetModelAnd(function() {
          // Ensure that model reload is always the same if it's desired ("randomSeed" paramenter
          // is provided).
          generateRandomSeed();
          controller.loadModel(currentModelID, initialModelConfig, options.propertiesToRetain, options.cause);
        });
      },

      /**
       * Reset the model to its initial state. The interactives controller will emit
       * a 'willResetModel'. The willResetModel observers can ask to wait for asynchronous
       * confirmation before the model is actually reset; see the notifyWillResetModelAnd function.
       *
       * Once the reset is confirmed, model will issue a 'willReset' event, reset its tick history,
       * and emit a 'reset' event.
       *
       * @param {object} options hash of options, supported properties:
       *                         * propertiesToRetain - a list of properties to save before
       *                           the model reset and restore after reset.
       *                         * cause - cause of the reset action, e.g. "new-run".
      */
      resetModel: function(options) {
        model.stop();
        notifyWillResetModelAnd(function() {
          options = options || {};
          var retainedProperties = getRetainedProperties(options.propertiesToRetain);

          // Consumers of the model's events will see a reset event followed by the invalidation event
          // emitted when we set the model's parameters to their desired initial state. That's because
          // the model semantics don't include reset-with-saving-of-parameters, just reset-to-initial-
          // state. However, consumers of the interactive controller's modelReset event would expect
          // reset-to-initial-state and restoration-of-saved-parameter-values to be a single,
          // atomic event, given that they are triggered by the single
          // interactiveController.resetModel() method. (This is similar to the reason that the
          // interactive controller decorates its modelReset with a "cause" -- the model itself has no
          // notion of *why* it's reset, and doesn't distinguish "setting up an experimental run" from
          // "starting over"; those are interactive-level concepts.)
          //
          // Therefore, make sure to supress the modelReset event that would be automatically
          // emitted by our listener to the modelController's modelReset event, and emit modelReset
          // only after parameter values have been reset/restored.
          ignoreModelResetEvent = true;

          modelController.reset(options.cause);
          model.set(retainedProperties);
          notifyModelResetCallbacks(options.cause);

          ignoreModelResetEvent = false;
        });
      },

      updateModelView: function() {
        modelController.updateView();
      },

      repaintModelView: function() {
        modelController.repaint();
      },

      /**
        Notifies interactive controller that the dimensions of its container have changed.
        It triggers the layout algorithm again.
      */
      resize: function () {
        layoutInteractive();
        dispatch.resize();
      },
      /**
       * Adds an event listener for the specified type. Supported events:
       * "resize", "modelLoaded", "modelReset", "interactiveRendered" and "layoutUpdated".
       *
       * @param {string} type
       * @param  {function|null} callback Callback function or null (to remove callback).
       *
       * FIXME: We should using DispatchSupport exclusively to emit events (i.e., instead of
       * maintaining custom arrays of callbacks in interactives controller, pass each callback we
       * are given to dispatch.on()). The first step would be to modify dispatchSupport to handle
       * multiple listeners for a given event, instead of reusing d3.dispatch, which is intended for
       * a simpler use case. Similar code is already checked into Lab!
       *
       * As a second step, we should modify components so that instead of defining a
       * 'modelLoadedCallback' they simply register listeners for some event. (Note that we will
       * want to create 2 events to disambiguate the 2 senses of 'modelLoaded';
       * componentModelLoadedCallbacks are called at a slightly different point in the model loading
       * sequence than 'regular' modelLoadedCallbacks.)
       */
      on: function (type, callback) {
        // Note that we can't use DispatchSupport as willResetModel event is a special one.
        // We have know number of objects interested in this event and we have to let them cancel
        // reset operation.
        if (type === "willResetModel") {
          willResetModelCallbacks.push(callback);
        } else {
          dispatch.on(type, callback);
        }
      },

      /**
       * Gets interactive property from interactive JSON definition.
       * @param  {string} name Property name.
       * @return {*}      Property value.
       */
      get: function (name) {
        return interactive[name];
      },

      /**
        Serializes interactive, returns object ready to be stringified.
        e.g. JSON.stringify(interactiveController.serialize());
      */
      serialize: function () {
        var result, i, len;
        // Copy basic properties from the initial definition, as they are immutable.
        // FIXME: this should be based on enumerating properties in the metadata. The issue is properties
        // added to the metadata like "importedFrom" have to be then manually added here.
        // NP: +1 on enumerating the metadata props here.
        result = {
          title: interactive.title,
          publicationStatus: interactive.publicationStatus,
          labEnvironment: interactive.labEnvironment,
          subtitle: interactive.subtitle,
          category: interactive.category,
          subCategory: interactive.subCategory,
          screenshot: interactive.screenshot,
          aspectRatio: interactive.aspectRatio,
          fontScale: interactive.fontScale,
          lang: interactive.lang,
          i18nMetadata: interactive.i18nMetadata,
          helpOnLoad: interactive.helpOnLoad,
          about: arrays.isArray(interactive.about) ? $.extend(true, [], interactive.about) : interactive.about,
          theme: interactive.theme,
          showTopBar: interactive.showTopBar,
          showBottomBar: interactive.showBottomBar,
          padding: interactive.padding,
          // Node that modelDefinitions section can also contain custom parameters definition. However, their initial values
          // should be already updated (take a look at the beginning of this function), so we can just serialize whole array.
          models: $.extend(true, [], interactive.models),
          propertiesToRetain: $.extend(true, [], interactive.propertiesToRetain),
          // All used parameters are already updated, they contain currently used values.
          parameters: $.extend(true, [], interactive.parameters),
          // Outputs are directly bound to the model, we can copy their initial definitions.
          outputs: $.extend(true, [], interactive.outputs),
          filteredOutputs: $.extend(true, [], interactive.filteredOutputs),
          helpTips: $.extend(true, [], interactive.helpTips)
        };

        // Update parameters' initial values.
        if (model !== undefined && model.get !== undefined) {
          // Basically, parameters can be defined in two places - in model definition object or just as a top-level
          // property of the interactive definition. Note that when particular parameter is defined in both places
          // it means that the parameter from *model* definition will be used. That's why we keep track
          // of parameters defined in the model definition.
          var modelParams = (function() {
            for (var i = 0, len = result.models.length; i < len; i++) {
              if (result.models[i].id === currentModelID) {
                return result.models[i].parameters || [];
              }
            }
            return [];
          }());
          var interactiveParams = result.parameters;
          var isModelParameter = {};
          modelParams.forEach(function (param) {
            isModelParameter[param.name] = true;
            var val = model.get(param.name);
            if (val !== undefined) {
              // Deep copy of the initial value. Otherwise, if value is an object or array, all
              // updates to parameter value will be shared with serialized value.
              param.initialValue = clone(val);
            }
          });
          interactiveParams.forEach(function (param) {
            // The parameter is overwritten by model parameter and shouldn't be updated here.
            if (isModelParameter[param.name]) return;
            var val = model.get(param.name);
            if (val !== undefined) {
              // Deep copy of the initial value. Otherwise, if value is an object or array, all
              // updates to parameter value will be shared with serialized value.
              param.initialValue = clone(val);
            }
          });
        }

        // add optional attributes to result if defined
        if (interactive.importedFrom !== undefined) {
          result.importedFrom = interactive.importedFrom;
        }

        if (interactive.exports !== undefined) {
          result.exports = $.extend(true, {}, interactive.exports);
        }

        if (interactive.experiment !== undefined) {
          result.experiment = $.extend(true, {}, interactive.experiment);
        }

        if (interactive.randomSeed !== undefined) {
          result.randomSeed = interactive.randomSeed;
        }

        // Serialize only public data sets. Data sets automatically created by components
        // (e.g. table of graph) won't be serialized as a first-class objects in interactive JSON.
        result.dataSets = [];
        for (var dsName in publicDataSetsByName) {
          result.dataSets.push(publicDataSetsByName[dsName].serialize());

        }

        // Serialize components.
        result.components = [];
        for (i = 0, len = componentList.length; i < len; i++) {
          if (componentList[i].serialize) {
            result.components.push(componentList[i].serialize());
          }
        }

        // Copy layout from the initial definition, as it is immutable.
        result.layout = $.extend(true, {}, interactive.layout);
        if (typeof interactive.template === "string") {
          result.template = interactive.template;
        } else {
          result.template = $.extend(true, [], interactive.template);
        }

        return result;
      },

      benchmarks: [
        {
          name: "interactive",
          numeric: false,
          run: function(done) {
            done(window.location.pathname + window.location.hash);
          }
        },
        {
          name: "layout (iterations)",
          numeric: true,
          formatter: d3.format("g"),
          run: function(done) {
            done(semanticLayout.layoutInteractive());
          }
        },
        {
          name: "layout (ms)",
          numeric: true,
          formatter: d3.format("5.1f"),
          run: function(done) {
            var start = +Date.now();
            semanticLayout.layoutInteractive();
            done(Date.now() - start);
          }
        }
      ],

      getLoadedModelId: function () {
        return currentModelID;
      },

      validateInteractive: validateInteractive
    };

    //
    // Initialization.
    //

    // Select interactive container.
    $interactiveContainer = $(viewSelector);
    $interactiveContainer.addClass("lab-interactive-container");

    // Initialize semantic layout.
    semanticLayout = new SemanticLayout();
    controller.on("resize.share-dialog", function () {
      shareDialog.updateIframeSize();
    });

    // Setup messaging with embedding parent window.
    parentMessageAPI = new ParentMessageAPI(controller);

    // Load interactive if it's provided.
    if (interactiveReference != null) {
      loadInteractive(interactiveReference);
    }

    return controller;
  };
});
