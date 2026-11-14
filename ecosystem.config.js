const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'somity-api',
      cwd: path.join(__dirname, 'backend'),
      script: 'dist/src/server.js',
      exec_mode: 'fork',
      instances: 1,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: '3004',
      },
    },
  ],
};
