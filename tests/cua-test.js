// Simple test script for the Computer Use Agent
// Run this with: OPENAI_API_KEY=your-key node tests/cua-test.js

// Import the server modules from the SDK
const { createServer } = require('../lib/index');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

async function testCUA() {
  console.log("Creating server...");
  
  // Create a Playwright MCP server with vision enabled
  const server = createServer({ vision: true });
  
  // Need to connect a transport to make it work
  const transport = new StdioServerTransport();
  server.connect(transport);
  
  console.log("Server connected");
  
  try {
    // Get the tools list
    console.log("\nGetting tools list...");
    const toolsResponse = await server.request({
      method: 'list_tools',
      id: '1',
      params: {},
    });
    
    console.log('Available tools:');
    const cuaTools = toolsResponse.tools.filter(tool => tool.name.startsWith('agent_'));
    for (const tool of cuaTools) {
      console.log(`- ${tool.name}: ${tool.description}`);
    }
    
    // Start a CUA session
    console.log('\nStarting CUA session...');
    const startResponse = await server.request({
      method: 'call_tool',
      id: '2',
      params: {
        name: 'agent_start',
        arguments: {
          instructions: 'Go to https://www.example.com and take a screenshot',
          apiKey: process.env.OPENAI_API_KEY,
        },
      },
    });
    
    const sessionData = JSON.parse(startResponse.content[0].text);
    console.log(`Session started: ${JSON.stringify(sessionData)}`);
    const sessionId = sessionData.sessionId;
    
    // Poll for status
    console.log('\nPolling status...');
    let isComplete = false;
    
    // Max attempts to poll (timeout)
    const maxAttempts = 30;
    let attempts = 0;
    
    while (!isComplete && attempts < maxAttempts) {
      attempts++;
      
      const statusResponse = await server.request({
        method: 'call_tool',
        id: '3',
        params: {
          name: 'agent_status',
          arguments: {
            sessionId,
            waitSeconds: 2,
          },
        },
      });
      
      const statusData = JSON.parse(statusResponse.content[0].text);
      console.log(`Status: ${JSON.stringify(statusData)}`);
      
      isComplete = statusData.status === 'completed' || statusData.status === 'error';
      
      if (!isComplete) {
        console.log("Waiting 2s before next poll...");
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Get logs without images for console display
    console.log('\nGetting session logs...');
    const logResponse = await server.request({
      method: 'call_tool',
      id: '4',
      params: {
        name: 'agent_log',
        arguments: {
          sessionId,
          includeImages: false, // Don't include images in console output
        },
      },
    });
    
    console.log('\nSession logs:');
    for (const item of logResponse.content) {
      if (item.type === 'text') {
        console.log(item.text);
      } else if (item.type === 'image') {
        console.log("[IMAGE DATA]");
      }
    }
    
    // End the session
    console.log('\nEnding session...');
    const endResponse = await server.request({
      method: 'call_tool',
      id: '5',
      params: {
        name: 'agent_end',
        arguments: {
          sessionId,
        },
      },
    });
    
    console.log(`Session ended: ${endResponse.content[0].text}`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Close the server
    console.log("\nClosing server...");
    await server.close();
    console.log("Server closed");
  }
}

testCUA().catch(console.error);