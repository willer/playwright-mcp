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

/**
 * This test provides a minimal validation that the CUA implementation
 * can successfully connect to the OpenAI API and start a session.
 * It's designed to run quickly to avoid MCP timeout issues.
 */

// Keep the test very short to avoid MCP timeout
test.setTimeout(30000); // 30 seconds

test('CUA minimal integration test', async ({ client }) => {
  // Skip the test if no OpenAI API key is available
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('Skipping CUA minimal integration test - no OPENAI_API_KEY found');
    test.skip();
    return;
  }

  let sessionId: string | undefined;
  
  try {
    console.log('Starting minimal CUA integration test');
    
    // 1. Start a simple session
    const startResponse = await client.callTool('agent_start', {
      startUrl: 'https://example.com', // Simple test site that loads quickly
      instructions: 'What do you see on this page?'
    });
    
    // Parse the response to get session ID
    const startResponseText = (startResponse.content[0] as any).text;
    const startResponseData = JSON.parse(startResponseText);
    sessionId = startResponseData.sessionId;
    
    console.log(`Session started successfully with ID: ${sessionId}`);
    expect(sessionId).toBeTruthy();
    
    // 2. Immediately get status to verify the session is running
    const statusResponse = await client.callTool('agent_status', { 
      sessionId,
      waitSeconds: 1 // Very short wait to avoid timeout
    });
    
    // Verify we got a status response
    expect(statusResponse).toBeTruthy();
    expect(statusResponse.content).toBeTruthy();
    expect(statusResponse.content.length).toBeGreaterThan(0);
    
    // Parse status
    const statusText = (statusResponse.content[0] as any).text;
    const statusData = JSON.parse(statusText);
    
    console.log(`Session status: ${statusData.status}`);
    
    // Either running or completed status indicates success
    expect(statusData.status === 'running' || statusData.status === 'completed').toBeTruthy();
    
    // 3. Try to get the current image
    const imageResponse = await client.callTool('agent_get_last_image', { sessionId });
    
    // Verify we got an image response
    expect(imageResponse).toBeTruthy();
    expect(imageResponse.content).toBeTruthy();
    expect(imageResponse.content.length).toBeGreaterThan(0);
    
    // Check if the image data is available
    const imageData = (imageResponse.content[0] as any).data;
    expect(imageData).toBeTruthy();
    
    console.log('Successfully retrieved screenshot');
    
    // Save evidence
    const testDir = path.join(process.cwd(), 'test-results', 'cua-minimal');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    // Save image
    fs.writeFileSync(
      path.join(testDir, 'screenshot.jpg'),
      Buffer.from(imageData, 'base64')
    );
    
    // Test pass - we successfully started and interacted with a CUA session
    console.log('Minimal integration test successful');
    
  } catch (error) {
    console.error('Test error:', error);
    throw error;
  } finally {
    // End the session if it was created
    if (sessionId) {
      try {
        console.log('Ending session');
        await client.callTool('agent_end', { sessionId });
      } catch (e) {
        console.error('Error ending session:', e);
      }
    }
  }
});