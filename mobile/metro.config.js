const { getDefaultConfig } = require('expo/metro-config');

/**
 * Metro does not treat .onnx as an asset out of the box, so the model files
 * would be resolved as JavaScript modules and fail the build. Registering the
 * extension is what lets `require('@/assets/models/detector.onnx')` return a
 * URI the ONNX Runtime can open.
 */
const config = getDefaultConfig(__dirname);
config.resolver.assetExts = [...config.resolver.assetExts, 'onnx'];

module.exports = config;
