#!/usr/bin/env node

/**
 * Script to find available ports and run the MCP inspector
 */

const { spawn, execSync } = require('child_process');
const net = require('net');
const path = require('path');

// Function to check if a port is available
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', () => {
      resolve(false); // Port is in use
    });
    
    server.once('listening', () => {
      server.close();
      resolve(true); // Port is available
    });
    
    server.listen(port);
  });
}

// Find an available port pair in a range
async function findAvailablePorts(startClientPort, startServerPort, count) {
  for (let i = 0; i < count; i++) {
    const clientPort = startClientPort + i;
    const serverPort = startServerPort + i;
    
    const [clientAvailable, serverAvailable] = await Promise.all([
      isPortAvailable(clientPort),
      isPortAvailable(serverPort)
    ]);
    
    if (clientAvailable && serverAvailable) {
      return { clientPort, serverPort };
    }
  }
  
  // If no ports are available in the range, return null
  return null;
}

// Main function
async function main() {
  try {
    // Make sure the project is built first
    console.log('Building the project...');
    execSync('npm run build', { stdio: 'inherit' });
    
    // Find available ports
    const startClientPort = 8001;
    const startServerPort = 9001;
    const portCount = 10;
    
    console.log(`Finding available ports in ranges ${startClientPort}-${startClientPort + portCount - 1} and ${startServerPort}-${startServerPort + portCount - 1}...`);
    const ports = await findAvailablePorts(startClientPort, startServerPort, portCount);
    
    if (!ports) {
      console.error('No available port pairs found in the specified ranges');
      process.exit(1);
    }
    
    // Log the selected ports
    console.log(`Using ports: Client=${ports.clientPort}, Server=${ports.serverPort}`);
    
    // Set up environment for the inspector
    const env = { ...process.env };
    env.CLIENT_PORT = ports.clientPort;
    env.SERVER_PORT = ports.serverPort;
    
    // Run the inspector
    console.log('Starting MCP inspector...');
    const inspector = spawn('npx', ['@modelcontextprotocol/inspector', 'node', 'cli.js'], { 
      stdio: 'inherit', 
      env 
    });
    
    // Handle process exit
    inspector.on('exit', (code) => {
      process.exit(code);
    });
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();