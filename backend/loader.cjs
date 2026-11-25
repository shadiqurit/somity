'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const entryUrl = pathToFileURL(path.join(__dirname, 'dist', 'src', 'server.js')).href;

import(entryUrl).catch((error) => {
  console.error('Failed to start Somity server:', error);
  process.exit(1);
});
