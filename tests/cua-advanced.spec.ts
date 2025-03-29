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
 * This test diagnoses issues with the CUA for real-world scenarios
 * by trying a more complex instruction and extensive logging.
 */
test('test CUA complex instruction', async ({ startClient }) => {
  // Create a client instance that properly passes environment variables
  const client = await startClient({
    env: process.env
  });

  // Start the agent session with a more complex instruction that requires visual analysis
  const startResponse = await client.callTool({
    name: 'agent_start',
    arguments: {
      instructions: 'Navigate to google.com, search for "colorful dish sets", and click on one of the search results.',
    },
  });

  // Parse the response to check if it has a session ID or error
  const startResponseJson = JSON.parse(startResponse.content[0].text);
  console.log('Agent start response:', startResponse.content[0].text);

  // Check for missing API key error
  if (startResponseJson.error && startResponseJson.error.includes('No OpenAI API key found in environment'))
    throw new Error(`CUA failed to start - OpenAI API key not found in environment. Make sure OPENAI_API_KEY is set.`);


  // We should have a valid session
  expect(startResponseJson).toHaveProperty('sessionId');
  expect(startResponseJson).toHaveProperty('status');

  const sessionId = startResponseJson.sessionId;
  console.log('Session created with ID:', sessionId);

  // Wait for some initial processing
  console.log('Waiting for initial processing...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Poll status every 5 seconds for up to 1 minute
  const maxWaitTime = 60000;
  const pollingInterval = 5000;
  let totalWaitTime = 0;
  let currentStatus = '';

  console.log('Polling status:');
  while (totalWaitTime < maxWaitTime) {
    const statusResponse = await client.callTool({
      name: 'agent_status',
      arguments: {
        sessionId,
      },
    });

    const statusResponseJson = JSON.parse(statusResponse.content[0].text);
    currentStatus = statusResponseJson.status;
    console.log(`  Status after ${totalWaitTime}ms: ${currentStatus} (running time: ${statusResponseJson.runningTime}ms)`);

    if (currentStatus === 'completed' || currentStatus === 'error')
      break;


    // Retrieve logs to see current progress
    const logResponse = await client.callTool({
      name: 'agent_log',
      arguments: {
        sessionId,
        includeImages: false,
      },
    });

    // Get the latest log entries
    const logTexts = logResponse.content
        .filter(item => item.type === 'text')
        .map(item => item.text);

    // Show the last 3 log entries
    const lastLogs = logTexts.slice(-3);
    console.log('  Latest log entries:');
    lastLogs.forEach(log => console.log(`    ${log}`));

    totalWaitTime += pollingInterval;
    await new Promise(resolve => setTimeout(resolve, pollingInterval));
  }

  console.log(`Agent ${currentStatus} after ${totalWaitTime}ms`);

  // Get full logs for analysis
  const finalLogResponse = await client.callTool({
    name: 'agent_log',
    arguments: {
      sessionId,
      includeImages: false,
    },
  });

  const logTexts = finalLogResponse.content
      .filter(item => item.type === 'text')
      .map(item => item.text);

  console.log('\nFull logs:');
  logTexts.forEach(log => console.log(log));

  // Analyze execution to identify problems
  const parseLog = logTexts.find(text => text.includes("Agent's plan:"));
  if (parseLog) {
    console.log('\nAI Response (Plan):');
    console.log(parseLog);
  }

  const actionLogs = logTexts.filter(text =>
    text.includes('navigate') ||
    text.includes('click') ||
    text.includes('type') ||
    text.includes('pressing') ||
    text.includes('Taking screenshot')
  );

  console.log('\nAction logs:');
  actionLogs.forEach(log => console.log(log));

  // End the session
  await client.callTool({
    name: 'agent_end',
    arguments: {
      sessionId,
    },
  });
});
