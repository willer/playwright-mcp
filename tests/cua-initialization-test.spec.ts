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
 * This test simply checks that we can successfully initialize a CUA session.
 * It doesn't test full functionality, just that the API request format is correct.
 */

test('CUA initialization test', async ({ client }) => {
  // Skip the test if no OpenAI API key is available
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('Skipping CUA initialization test - no OPENAI_API_KEY found');
    test.skip();
    return;
  }

  let sessionId: string | undefined;
  
  try {
    // Start the agent session with a simple test URL
    console.log('Testing agent_start call...');
    const startResponse = await client.callTool('agent_start', {
      startUrl: 'https://example.com',
      instructions: 'Just look at this page and tell me what you see.'
    });
    
    // Parse the response to get session ID
    const startResponseText = (startResponse.content[0] as any).text;
    const startResponseData = JSON.parse(startResponseText);
    sessionId = startResponseData.sessionId;
    
    console.log(`Got session ID: ${sessionId}`);
    expect(sessionId).toBeTruthy();
    
    // Immediately get status to validate that works too
    console.log('Testing agent_status call...');
    const statusResponse = await client.callTool('agent_status', { 
      sessionId,
      waitSeconds: 1
    });
    
    const statusText = (statusResponse.content[0] as any).text;
    const statusData = JSON.parse(statusText);
    console.log('Status response:', statusData);
    
    // Success! The session was created and we got the status
    console.log('✅ CUA initialization test passed - OpenAI accepts our API format');
    
  } catch (error) {
    console.error('Test error:', error);
    throw error;
  } finally {
    // End the session if it was created
    if (sessionId) {
      try {
        console.log('Ending agent session...');
        await client.callTool('agent_end', { sessionId });
      } catch (e) {
        console.error('Error ending session:', e);
      }
    }
  }
});