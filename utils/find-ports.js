#!/usr/bin/env node

/**
 * Script to find available ports for the Playwright MCP inspector
 */

const net = require('net');

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
    const startClientPort = 8001;
    const startServerPort = 9001;
    const portCount = 10;
    
    const ports = await findAvailablePorts(startClientPort, startServerPort, portCount);
    
    if (ports) {
      // Output the ports as JSON
      console.log(JSON.stringify(ports));
      process.exit(0);
    } else {
      console.error(`No available port pairs found in range ${startClientPort}-${startClientPort + portCount - 1} and ${startServerPort}-${startServerPort + portCount - 1}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('Error finding ports:', error);
    process.exit(1);
  }
}

main();