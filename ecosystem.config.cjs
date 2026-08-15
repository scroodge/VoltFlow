module.exports = {
  apps: [
    {
      name: 'voltflow-3000',
      cwd: __dirname,
      script: 'node_modules/next/dist/bin/next',
      args: 'dev',
      interpreter: 'node',
      env: { NODE_ENV: 'development' },
    },
    {
      name: 'voltflow-telegram-8787',
      cwd: __dirname,
      script: 'scripts/telegram-miniapp-server.py',
      interpreter: 'python3',
      env: { PYTHONUNBUFFERED: '1' },
    },
  ],
};
