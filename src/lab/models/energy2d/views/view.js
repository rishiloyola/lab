/*global define: false */

define(function (require) {
  var SVGContainer = require('common/views/svg-container'),
      Renderer     = require('models/energy2d/views/renderer');

  return function (model, modelUrl) {
    return new SVGContainer(model, modelUrl, Renderer, {origin: 'top-left'});
  };

});
