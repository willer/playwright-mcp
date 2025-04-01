/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test, expect } from './fixtures';
import * as fs from 'fs';
import * as path from 'path';
import { setTimeout } from 'timers/promises';

/**
 * This is a comprehensive integration test for the CUA implementation.
 * It verifies that the agent can successfully:
 * 1. Start a session and navigate to Amazon
 * 2. Engage in conversation about dish sets
 * 3. Respond to a follow-up request for a specific style
 * 4. Complete the conversation successfully
 * 
 * This test aims to validate the entire conversation flow functions correctly.
 */

// Define a shorter timeout to work with MCP limits
test.setTimeout(120000); // 2 minutes

test('CUA dish set search conversation test', async ({ client }) => {
  // Skip the test if no OpenAI API key is available
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('Skipping CUA integration test - no OPENAI_API_KEY found');
    test.skip();
    return;
  }

  // Create a test directory for evidence
  const testDir = path.join(process.cwd(), 'test-results', 'cua-integration');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  let sessionId: string | undefined;
  
  try {
    // Start the test with clear logging
    console.log('=== STARTING CUA INTEGRATION TEST ===');
    console.log('Step 1: Starting agent session on Amazon');
    
    // Record start time for performance benchmarking
    const startTime = Date.now();
    
    // 1. Start the agent session with specific instructions to find a dish set
    const startResponse = await client.callTool('agent_start', {
      startUrl: 'https://amazon.com',
      instructions: 'Find a nice dish set and add it to the cart please'
    });
    
    // Parse the response to get session ID
    const startResponseText = (startResponse.content[0] as any).text;
    const startResponseData = JSON.parse(startResponseText);
    sessionId = startResponseData.sessionId;
    
    console.log(`Got session ID: ${sessionId}`);
    expect(sessionId).toBeTruthy();
    
    // Save the session start data
    fs.writeFileSync(
      path.join(testDir, '1-start-response.json'),
      JSON.stringify(startResponse, null, 2)
    );
    
    // 2. Wait for initial question from the agent
    console.log('Step 2: Waiting for agent to begin task and ask questions...');
    
    // Poll for status and completion of first task
    let firstMessageReceived = false;
    let firstMessageText = '';
    let maxPolls = 10;
    
    for (let i = 0; i < maxPolls && !firstMessageReceived; i++) {
      // Check status with wait
      const statusResponse = await client.callTool('agent_status', { 
        sessionId,
        waitSeconds: 2
      });
      
      // Parse status
      const statusText = (statusResponse.content[0] as any).text;
      const statusData = JSON.parse(statusText);
      
      console.log(`Poll ${i+1}: Status = ${statusData.status}`);
      
      // If completed, check for message content
      if (statusData.status === 'completed') {
        // Get logs to find the message
        const logResponse = await client.callTool('agent_log', { 
          sessionId,
          includeImages: false 
        });
        
        // Save logs
        fs.writeFileSync(
          path.join(testDir, `2-logs-first-response.json`),
          JSON.stringify(logResponse, null, 2)
        );
        
        // Extract message text from logs
        const logs = logResponse.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text);
        
        // Find the message line in logs
        const messageLine = logs.find((line: string) => line.startsWith('Message:'));
        if (messageLine) {
          firstMessageText = messageLine.replace('Message:', '').trim();
          console.log(`Agent's first message: "${firstMessageText}"`);
          firstMessageReceived = true;
          break;
        }
      }
      
      // Wait before checking again
      await setTimeout(2000);
    }
    
    // Verify we received the first message
    expect(firstMessageReceived).toBeTruthy();
    expect(firstMessageText).not.toBe('');
    
    // Get screenshot of current state
    try {
      const imageResponse = await client.callTool('agent_get_last_image', { sessionId });
      if (imageResponse.content[0] && (imageResponse.content[0] as any).data) {
        const imageData = (imageResponse.content[0] as any).data;
        fs.writeFileSync(
          path.join(testDir, `2-first-screenshot.jpg`),
          Buffer.from(imageData, 'base64')
        );
      }
    } catch (e) {
      console.log('Failed to get first screenshot:', e);
    }
    
    // 3. Send a reply about French country style
    console.log('Step 3: Replying to the agent with style preference...');
    
    const replyText = 'Something really nice, fitting an upscale French country house';
    const replyResponse = await client.callTool('agent_reply', {
      sessionId,
      replyText
    });
    
    // Save the reply response
    fs.writeFileSync(
      path.join(testDir, '3-reply-response.json'),
      JSON.stringify(replyResponse, null, 2)
    );
    
    // 4. Wait for response to our reply
    console.log('Step 4: Waiting for agent to respond to our style preference...');
    
    let secondMessageReceived = false;
    let secondMessageText = '';
    
    for (let i = 0; i < maxPolls && !secondMessageReceived; i++) {
      // Check status with wait
      const statusResponse = await client.callTool('agent_status', { 
        sessionId,
        waitSeconds: 2
      });
      
      // Parse status
      const statusText = (statusResponse.content[0] as any).text;
      const statusData = JSON.parse(statusText);
      
      console.log(`Poll ${i+1}: Status = ${statusData.status}`);
      
      // If completed, check for message content
      if (statusData.status === 'completed') {
        // Get logs to find the message
        const logResponse = await client.callTool('agent_log', { 
          sessionId,
          includeImages: false 
        });
        
        // Save logs
        fs.writeFileSync(
          path.join(testDir, `4-logs-second-response.json`),
          JSON.stringify(logResponse, null, 2)
        );
        
        // Extract message text from logs
        const logs = logResponse.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text);
        
        // Count the number of message entries
        const messageLines = logs.filter((line: string) => line.startsWith('Message:'));
        
        // If we have at least 2 messages, get the second one
        if (messageLines.length >= 2) {
          secondMessageText = messageLines[1].replace('Message:', '').trim();
          console.log(`Agent's second message: "${secondMessageText}"`);
          secondMessageReceived = true;
          break;
        }
      }
      
      // Wait before checking again
      await setTimeout(2000);
    }
    
    // Verify we received the second message
    expect(secondMessageReceived).toBeTruthy();
    expect(secondMessageText).not.toBe('');
    
    // Get screenshot after the conversation
    try {
      const imageResponse = await client.callTool('agent_get_last_image', { sessionId });
      if (imageResponse.content[0] && (imageResponse.content[0] as any).data) {
        const imageData = (imageResponse.content[0] as any).data;
        fs.writeFileSync(
          path.join(testDir, `4-second-screenshot.jpg`),
          Buffer.from(imageData, 'base64')
        );
      }
    } catch (e) {
      console.log('Failed to get second screenshot:', e);
    }
    
    // 5. End the session 
    console.log('Step 5: Ending session');
    await client.callTool('agent_end', { sessionId });
    
    // 6. Produce test summary
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    const summary = {
      test: 'CUA Dish Set Conversation',
      duration: `${duration}ms`,
      sessionId,
      firstMessage: {
        received: firstMessageReceived,
        text: firstMessageText
      },
      reply: {
        text: replyText
      },
      secondMessage: {
        received: secondMessageReceived,
        text: secondMessageText
      },
      result: secondMessageReceived ? 'Success' : 'Incomplete'
    };
    
    fs.writeFileSync(
      path.join(testDir, '5-test-summary.json'),
      JSON.stringify(summary, null, 2)
    );
    
    console.log('=== TEST SUMMARY ===');
    console.log(JSON.stringify(summary, null, 2));
    console.log('===================');
    
    // Test success validation
    expect(firstMessageReceived).toBeTruthy();
    expect(secondMessageReceived).toBeTruthy();
    
    // The important part is not specific content but the ability to have
    // a multi-turn conversation through the CUA interface
    
  } catch (error) {
    console.error('Test error:', error);
    
    // Save error details
    fs.writeFileSync(
      path.join(testDir, 'test-error.json'),
      JSON.stringify({
        error: error.toString(),
        stack: error.stack,
        timestamp: new Date().toISOString()
      }, null, 2)
    );
    
    throw error;
  } finally {
    // End the session if it was created
    if (sessionId) {
      try {
        await client.callTool('agent_end', { sessionId });
      } catch (e) {
        console.error('Error ending session:', e);
      }
    }
    
    console.log('Test complete - check test-results/cua-integration for details');
  }
});