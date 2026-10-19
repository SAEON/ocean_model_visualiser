import { GeoJsonLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { MaskExtension } from '@deck.gl/extensions';
import { interpolateColor } from '../utils/colorScales';

/**
 * Creates Land Mask Layer
 */
export function createLandMaskLayer(maskData) {
  if (!maskData) return null;
  return new GeoJsonLayer({
    id: 'land-mask',
    data: maskData,
    operation: 'mask',
    getFillColor: [0, 0, 0, 255]
  });
}

/**
 * Creates Scalar Contour GeoJsonLayer
 */
export function createContourLayer({
  contours,
  activeValMin,
  activeValMax,
  stops,
  maskData,
  opacity = 150
}) {
  if (!contours) return null;

  return new GeoJsonLayer({
    id: 'contour-layer',
    data: contours,
    filled: true,
    stroked: true,
    lineWidthScale: 1,
    lineWidthMinPixels: 0.5,
    getFillColor: (f) => {
      const val = f.properties.value;
      const t = (val - activeValMin) / (activeValMax - activeValMin || 1);
      const rgb = interpolateColor(t, stops);
      return [...rgb, opacity];
    },
    getLineColor: [0, 0, 0, 40],
    getLineWidth: 0.5,
    extensions: maskData ? [new MaskExtension()] : [],
    maskId: 'land-mask',
    maskInverted: true,
    updateTriggers: {
      getFillColor: [activeValMin, activeValMax, stops, opacity]
    }
  });
}

/**
 * Creates Currents / Vector Pairs PathLayer
 */
export function createVectorArrowsLayer({
  displayCurrents,
  quantizedLatitude,
  viewState,
  quantizedZoom,
  autoMaxPixels,
  currentMaxSpeed,
  maxSpeed,
  autoDownsampleRate,
  maskData
}) {
  if (!displayCurrents || displayCurrents.length === 0) return null;

  const lat = quantizedLatitude ?? (viewState?.latitude || -34);
  const latRad = (lat * Math.PI) / 180;
  const degPerPixel = 360 / (256 * Math.pow(2, quantizedZoom) * Math.cos(latRad));
  const TARGET_MAX_PIXELS = autoMaxPixels;
  const refMaxSpeed = currentMaxSpeed > 0 ? currentMaxSpeed : (maxSpeed || 1.5);
  const dynamicVectorScale = (TARGET_MAX_PIXELS * degPerPixel) / refMaxSpeed;

  return new PathLayer({
    id: 'currents-arrows',
    data: displayCurrents,
    pickable: true,
    widthMinPixels: 1.5,
    widthMaxPixels: 3.5,
    getPath: (d) => {
      let dx = d.u * dynamicVectorScale;
      let dy = d.v * dynamicVectorScale;
      let L = Math.sqrt(dx * dx + dy * dy);
      if (L === 0) return [[d.lng, d.lat], [d.lng, d.lat]];

      const maxAllowedL = TARGET_MAX_PIXELS * 1.5 * degPerPixel;
      if (L > maxAllowedL) {
        const scale = maxAllowedL / L;
        dx *= scale;
        dy *= scale;
        L = maxAllowedL;
      }

      const theta = Math.atan2(dy, dx);
      const barbLength = Math.min(L * 0.35, 7 * degPerPixel);

      return [
        [d.lng, d.lat],
        [d.lng + dx, d.lat + dy],
        [d.lng + dx + barbLength * Math.cos(theta + 2.6), d.lat + dy + barbLength * Math.sin(theta + 2.6)],
        [d.lng + dx, d.lat + dy],
        [d.lng + dx + barbLength * Math.cos(theta - 2.6), d.lat + dy + barbLength * Math.sin(theta - 2.6)]
      ];
    },
    getColor: [0, 0, 0],
    getWidth: 2.2,
    extensions: maskData ? [new MaskExtension()] : [],
    maskId: 'land-mask',
    maskInverted: true,
    updateTriggers: {
      getPath: [displayCurrents, autoMaxPixels, autoDownsampleRate, quantizedZoom, currentMaxSpeed, maxSpeed]
    }
  });
}

/**
 * Creates Grid Points Probe ScatterplotLayer
 */
export function createGridPointsLayer({
  pointsData,
  maskData,
  onPointClick
}) {
  if (!pointsData || pointsData.length === 0) return null;

  return new ScatterplotLayer({
    id: 'grid-points-layer',
    data: pointsData,
    pickable: true,
    opacity: 0.8,
    stroked: false,
    filled: true,
    radiusScale: 1,
    radiusMinPixels: 1.0,
    radiusMaxPixels: 10,
    lineWidthMinPixels: 1,
    getPosition: (d) => [d.lng, d.lat],
    getRadius: () => 350,
    getFillColor: [255, 255, 255, 220],
    extensions: maskData ? [new MaskExtension()] : [],
    maskId: 'land-mask',
    maskInverted: true,
    onClick: onPointClick
  });
}

/**
 * Creates Product Regions Boundary GeoJsonLayer
 */
export function createProductBoundaryLayer({
  products,
  clickedProduct,
  maskData,
  onProductClick
}) {
  const productRegions = (products || [])
    .filter(p => p.region && (!clickedProduct || p.id === clickedProduct.id))
    .map(p => ({
      type: 'Feature',
      geometry: p.region,
      properties: {
        id: p.id,
        name: p.name,
        isClicked: clickedProduct && p.id === clickedProduct.id
      }
    }));

  if (productRegions.length === 0) return null;

  return new GeoJsonLayer({
    id: maskData ? 'products-boundary-layer-masked' : 'products-boundary-layer-unmasked',
    data: {
      type: 'FeatureCollection',
      features: productRegions
    },
    pickable: true,
    stroked: true,
    filled: true,
    lineWidthScale: 1,
    lineWidthMinPixels: 2,
    getFillColor: (f) => f.properties.isClicked ? [14, 165, 233, 100] : [14, 165, 233, 40],
    getLineColor: (f) => f.properties.isClicked ? [14, 165, 233, 255] : [14, 165, 233, 220],
    getLineWidth: 2,
    extensions: maskData ? [new MaskExtension()] : [],
    maskId: 'land-mask',
    maskInverted: true,
    onClick: (info) => {
      if (info.object && onProductClick) {
        onProductClick(info.object.properties.id, info.object.properties.name);
      }
    }
  });
}

/**
 * High-level Layer Assembler orchestrating all enabled Deck.gl layers
 */
export function buildDeckLayers(ctx) {
  const layers = [];

  // 0. Land Mask
  const maskLayer = createLandMaskLayer(ctx.maskData);
  if (maskLayer) layers.push(maskLayer);

  // 1. Contours Layer
  if (ctx.showContours && ctx.renderedData?.contours && ctx.selectedMember) {
    const contourLayer = createContourLayer({
      contours: ctx.renderedData.contours,
      activeValMin: ctx.activeValMin,
      activeValMax: ctx.activeValMax,
      stops: ctx.stops,
      maskData: ctx.maskData
    });
    if (contourLayer) layers.push(contourLayer);
  }

  // 2. Currents Vector Arrows Layer
  if (ctx.showCurrents && ctx.displayCurrents?.length > 0 && ctx.selectedMember) {
    const currentsLayer = createVectorArrowsLayer({
      displayCurrents: ctx.displayCurrents,
      quantizedLatitude: ctx.quantizedLatitude,
      viewState: ctx.viewState,
      quantizedZoom: ctx.quantizedZoom,
      autoMaxPixels: ctx.autoMaxPixels,
      currentMaxSpeed: ctx.currentMaxSpeed,
      maxSpeed: ctx.maxSpeed,
      autoDownsampleRate: ctx.autoDownsampleRate,
      maskData: ctx.maskData
    });
    if (currentsLayer) layers.push(currentsLayer);
  }

  // 3. Grid Points Probe Layer
  if (ctx.selectedMember && ctx.showPoints && ctx.pointsData?.length > 0) {
    const pointsLayer = createGridPointsLayer({
      pointsData: ctx.pointsData,
      maskData: ctx.maskData,
      onPointClick: ctx.onPointClick
    });
    if (pointsLayer) layers.push(pointsLayer);
  }

  // 4. Product Boundary Boxes (when no member is selected)
  if (!ctx.selectedMember && ctx.products?.length > 0) {
    const boundaryLayer = createProductBoundaryLayer({
      products: ctx.products,
      clickedProduct: ctx.clickedProduct,
      maskData: ctx.maskData,
      onProductClick: ctx.onProductClick
    });
    if (boundaryLayer) layers.push(boundaryLayer);
  }

  return layers;
}
