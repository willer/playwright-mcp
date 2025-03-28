#!/usr/bin/env node
// Simple test script to dump tool schemas
const { spawn } = require('child_process');
const path = require('path');

// Path to the CLI
const cliPath = path.join(__dirname, '..', 'cli.js');

// Start the server in stdio mode
const server = spawn('node', [cliPath, '--vision']);

// Flag to track when we're receiving the response
let receivingResponse = false;
let responseData = '';

// Handle stdout
server.stdout.on('data', (data) => {
  const text = data.toString();
  console.log(`STDOUT: ${text}`);
  
  // Check if this starts a JSON response
  if (text.includes('"jsonrpc":"2.0"')) {
    receivingResponse = true;
    responseData += text;
  } else if (receivingResponse) {
    responseData += text;
  }
  
  // Check if the response is complete
  if (receivingResponse && responseData.includes('"tools":')) {
    try {
      // Parse the response to get the tools
      const match = responseData.match(/({[\s\S]*})/);
      if (match) {
        const json = JSON.parse(match[1]);
        console.log('\nFound tools:');
        const tools = json.result.tools;
        
        // Show all tools
        for (const tool of tools) {
          console.log(`- ${tool.name}: ${tool.description}`);
        }
        
        // Show just the agent tools
        console.log('\nCUA Tools:');
        const agentTools = tools.filter(t => t.name.startsWith('agent_'));
        for (const tool of agentTools) {
          console.log(`- ${tool.name}: ${tool.description}`);
        }
      }
    } catch (e) {
      console.error('Error parsing response:', e);
    }
    
    // Close the server
    server.kill();
    process.exit(0);
  }
});

// Handle stderr
server.stderr.on('data', (data) => {
  console.error(`STDERR: ${data.toString()}`);
});

// Handle server exit
server.on('close', (code) => {
  console.log(`Server process exited with code ${code}`);
});

// Send a request to list tools
const request = {
  jsonrpc: '2.0',
  id: '1',
  method: 'mcp.listTools',
  params: {}
};

// Write the request to the server's stdin
server.stdin.write(JSON.stringify(request) + '\n');

// Set a timeout in case the server doesn't respond
setTimeout(() => {
  console.error('Timeout waiting for response');
  server.kill();
  process.exit(1);
}, 10000);