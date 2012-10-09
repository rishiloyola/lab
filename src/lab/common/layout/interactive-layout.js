/*global define $ */

//
// Layout for non-embedded 'interactives' page
//
define(function (require) {
  // Dependencies.
  var layout = require('common/layout/layout');

  function setThermometerHeight(thermometerComponent, h) {
    // get height of thermometer label, including margin:
    var labelHeight = $('.interactive-thermometer p.label').outerHeight(true);

    $('.interactive-thermometer').height(h);
    // allow for a min-height calculation to make the height larger than h
    h = $('.interactive-thermometer').height();
    $('.interactive-thermometer .thermometer').height(h - labelHeight);

    thermometerComponent.redraw();
  }

  return function setupInteractiveLayout() {
    var i,
        w,
        h,
        modelWidth,
        modelHeight,
        modelDimensions,
        modelAspectRatio,
        modelWidthFactor,
        viewLists,
        viewSizes = {},
        viewType,
        containerWidth = $('#content').width(),
        containerHeight = $('#content').height(),
        emsize;

    // grab 'viewLists' from legacy layout system
    viewLists = layout.views;

    modelDimensions = viewLists.moleculeContainers[0].scale();
    w = modelDimensions[2];
    h = modelDimensions[3];
    modelAspectRatio = w / h;

    // Model container should take up 60% of parent container width...
    modelWidthFactor = 0.60;

    // unless there needs to be room for energy graph *and* thermometer
    if (viewLists.energyGraphs) {
      modelWidthFactor = 0.50;
    }

    modelWidth = containerWidth * modelWidthFactor;
    modelHeight = modelWidth / modelAspectRatio;

    // width of moleculeContainer derives automatically from height
    viewSizes.moleculeContainers = [modelWidth, modelHeight];

    if (viewLists.energyGraphs) {
      viewSizes.energyGraphs = [containerWidth * 0.45, modelHeight];
    }

    for (viewType in viewLists) {
      if (viewLists.hasOwnProperty(viewType) && viewLists[viewType].length) {
        i = -1;  while(++i < viewLists[viewType].length) {
          if (viewSizes[viewType]) {
            viewLists[viewType][i].resize(viewSizes[viewType][0], viewSizes[viewType][1]);
          } else {
            viewLists[viewType][i].resize();
          }
        }
      }
    }

    if (layout.views.thermometers) {
      setThermometerHeight(layout.views.thermometers[0], modelHeight * 0.8);
    }

    // FIXME this is a temporary hack ... put in layout code instead of memorializing it in the CSS,
    // which doesn't tend to get reviewed as closely.

    // Push the molecule-container down so its top lines up with the energy graph's top exactly.
    // After brief investigation, couldn't tell for sure why the energyGraph container was being pushed down ~5px by the browser...
    // if (viewLists.energyGraphs) {
    //   $(viewLists.moleculeContainers[0].outerNode).css('top', 5);
    // }

    // For non-embedded interactives, #viz doesn't need a min-height (content will push it down)
    // $('#viz.top').css('min-height', 0);
  };
});
