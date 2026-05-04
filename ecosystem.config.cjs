module.exports = {
  apps: [
    {
      name: 'picopark-server',
      script: './server/app.js',
      cwd: '.',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'development',
        PORT: '3000',
        SERVE_STATIC: '0',
        MONGODB_DB: 'picopark',
        MONGODB_REQUIRED: '0'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: '3000',
        SERVE_STATIC: '1',
        MONGODB_DB: 'picopark',
        MONGODB_REQUIRED: '1'
      }
    }
  ]
};
