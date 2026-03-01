const path = require('path');

module.exports = {
  apps: [
    {
      name: 'polymarket-service',
      script: path.resolve(__dirname, 'node_modules/.bin/tsx'),
      args: 'src/index.ts',
      interpreter: 'none',
      cwd: path.resolve(__dirname),
      instances: 1,
      exec_mode: 'fork',
      env: {
        PORT: process.env.PORT || 1110,
      },
      log_file: path.resolve(__dirname, '..', 'logs', 'polymarket-service.log'),
      out_file: '/dev/null',
      error_file: '/dev/null',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
    }
  ]
};
