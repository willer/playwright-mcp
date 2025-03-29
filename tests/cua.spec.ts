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

/**
 * This test verifies that the CUA (Computer Use Agent) functionality works
 * properly by setting up an interactive test page and requesting the agent
 * to perform an action on it.
 *
 * The test fixes a critical issue with environment variable passing between
 * the test process and the subprocess where the CUA runs.
 */
test('test CUA functionality', async ({ startClient }) => {
  // Create a client instance that properly passes environment variables
  const client = await startClient({
    env: process.env
  });

  // Set up a simple test HTML page with a button
  await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: 'data:text/html,<html><title>CUA Test</title><button id="testButton" style="padding: 20px; font-size: 20px; margin: 50px;">Click Me</button></html>',
    },
  });

  // Start the agent session with instructions to click the button
  const startResponse = await client.callTool({
    name: 'agent_start',
    arguments: {
      instructions: 'Click the button that says "Click Me"',
    },
  });

  // If we have an error about missing API key, fail the test
  const startResponseJson = JSON.parse(startResponse.content[0].text);
  if (startResponseJson.error && startResponseJson.error.includes('No OpenAI API key found in environment')) {
    throw new Error(`CUA failed to start - OpenAI API key not found in environment. Make sure OPENAI_API_KEY is set.
    Test env has key: ${!!process.env.OPENAI_API_KEY}`);
  }

  // We should have a valid session
  expect(startResponseJson).toHaveProperty('sessionId');
  expect(startResponseJson).toHaveProperty('status');

  const sessionId = startResponseJson.sessionId;

  // Wait for agent to complete its task
  // Allow up to 20 seconds (polling every 2 seconds)
  const maxWaitTime = 20000;
  const pollingInterval = 2000;
  let totalWaitTime = 0;
  let isCompleted = false;

  while (totalWaitTime < maxWaitTime && !isCompleted) {
    const statusResponse = await client.callTool({
      name: 'agent_status',
      arguments: {
        sessionId,
        waitSeconds: 2,
      },
    });

    const statusResponseJson = JSON.parse(statusResponse.content[0].text);
    expect(statusResponseJson).toHaveProperty('sessionId', sessionId);

    if (statusResponseJson.status === 'completed' || statusResponseJson.status === 'error') {
      isCompleted = true;
    } else {
      totalWaitTime += pollingInterval;
      await new Promise(resolve => setTimeout(resolve, pollingInterval));
    }
  }

  // Get the logs to verify what happened
  const logResponse = await client.callTool({
    name: 'agent_log',
    arguments: {
      sessionId,
      includeImages: false, // Set to false to simplify test output
    },
  });

  // Verify logs contain appropriate entries
  const logTexts = logResponse.content
      .filter(item => item.type === 'text')
      .map(item => item.text);

  // We should have logs
  expect(logTexts.length).toBeGreaterThan(5);

  // Check for essential log entries that indicate agent functionality
  expect(logTexts.some(text => text.includes('Agent session started'))).toBeTruthy();
  expect(logTexts.some(text => text.includes('Processing instructions with AI'))).toBeTruthy();
  expect(logTexts.some(text => text.includes('Taking screenshot') ||
                             text.includes('Screenshot') ||
                             text.includes('Clicking'))).toBeTruthy();

  // End the session
  const endResponse = await client.callTool({
    name: 'agent_end',
    arguments: {
      sessionId,
    },
  });

  const endResponseJson = JSON.parse(endResponse.content[0].text);
  expect(endResponseJson).toHaveProperty('sessionId', sessionId);
  expect(endResponseJson).toHaveProperty('status', 'completed');
});

/**
 * This test verifies the error handling capabilities of the CUA system
 * when invalid session IDs are provided.
 */
test('test CUA error handling', async ({ client }) => {
  const invalidSessionId = '00000000-0000-0000-0000-000000000000';

  // Test agent_status with invalid session
  const statusResponse = await client.callTool({
    name: 'agent_status',
    arguments: {
      sessionId: invalidSessionId,
    },
  });

  const statusResponseJson = JSON.parse(statusResponse.content[0].text);
  expect(statusResponseJson).toHaveProperty('error');
  expect(statusResponseJson.error).toContain('Session not found');

  // Test agent_log with invalid session
  const logResponse = await client.callTool({
    name: 'agent_log',
    arguments: {
      sessionId: invalidSessionId,
    },
  });

  const logResponseJson = JSON.parse(logResponse.content[0].text);
  expect(logResponseJson).toHaveProperty('error');
  expect(logResponseJson.error).toContain('Session not found');

  // Test agent_end with invalid session
  const endResponse = await client.callTool({
    name: 'agent_end',
    arguments: {
      sessionId: invalidSessionId,
    },
  });

  const endResponseJson = JSON.parse(endResponse.content[0].text);
  expect(endResponseJson).toHaveProperty('error');
  expect(endResponseJson.error).toContain('Session not found');
});
