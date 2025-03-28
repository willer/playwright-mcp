// Simple script to list available tools
const { createServer } = require('../lib/index');

async function listTools() {
  console.log('Creating server...');
  // Create a server with debug output
  const server = createServer({ vision: true });
  
  // Need to start the server to handle requests
  await server.listen();
  console.log('Server started');
  
  try {
    // Get the tools list
    console.log('Requesting tools list...');
    const response = await server.request({
      method: 'list_tools',
      id: '1',
      params: {},
    });
    
    console.log('All available tools:');
    for (const tool of response.tools) {
      console.log(`- ${tool.name}: ${tool.description}`);
    }
    
    console.log('\nCUA Tools:');
    const cuaTools = response.tools.filter(t => t.name.startsWith('agent_'));
    for (const tool of cuaTools) {
      console.log(`- ${tool.name}: ${tool.description}`);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Close the server
    await server.close();
  }
}

listTools().catch(console.error);