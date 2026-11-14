const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Keep resource usage modest on lower-end dev machines.
config.maxWorkers = 2;

module.exports = config;
