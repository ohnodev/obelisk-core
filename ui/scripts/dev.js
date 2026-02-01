#!/usr/bin/env node

const { execSync } = require('child_process');
const { getPort } = require('get-port');

async function startDev() {
  // Find an available port starting from 3000
  const port = await getPort({ port: 3000 });
  
  console.log(`🚀 Starting Obelisk Core UI on port ${port}...`);
  
  // Start Next.js on the available port
  execSync(`next dev --turbopack -p ${port}`, {
    stdio: 'inherit',
    cwd: __dirname + '/..'
  });
}

startDev().catch(console.error);
