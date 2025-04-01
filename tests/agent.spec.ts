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

/**
 * Tests for the Computer Use Agent (CUA) implementation.
 */
import { test, expect } from '@playwright/test';
import { agentStart, agentStatus, agentLog, agentEnd } from '../src/tools/cua';
import { Context } from '../src/context';
import { chromium } from 'playwright';
import * as https from 'https';

// Mock the https request for testing
test.beforeEach(() => {
  // Mock the https.request to avoid actual API calls
  const original = https.request;
  https.request = function(...args: any[]): any {
    const mockResponse = {
      on: (event: string, callback: Function) => {
        if (event === 'data') {
          callback(JSON.stringify({
            choices: [
              {
                message: {
                  content: 'I have completed the task successfully.'
                }
              }
            ]
          }));
        }
        if (event === 'end') {
          callback();
        }
      }
    };
    
    const mockRequest = {
      on: (event: string, callback: Function) => {
        return mockRequest;
      },
      write: () => {},
      end: () => {
        // Simulate a successful response
        const cb = args[1];
        if (typeof cb === 'function') {
          cb(mockResponse);
        }
      }
    };
    
    return mockRequest;
  } as any;
  
  return () => {
    https.request = original;
  };
});

test.describe('CUA Agent Tests', () => {
  let mockContext: Context;

  test.beforeEach(async () => {
    // Set up mock context with a browser page
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    // Navigate to a test page to ensure we have a valid page
    await page.goto('about:blank');
    
    // Create a minimal context for testing
    mockContext = {
      createPage: async () => page,
      existingPage: () => page,
      close: async () => await page.close(),
    } as unknown as Context;
  });

  test('should start a new agent session', async () => {
    const result = await agentStart.handle(mockContext, {
      instructions: 'Go to example.com and click the first link.',
      apiKey: 'fake-api-key'
    });

    // Check that the result contains a status
    const resultText = result.content[0].type === 'text' ? result.content[0].text : '';
    const resultObj = JSON.parse(resultText);

    expect(resultObj.status).toBeDefined();
    expect(resultObj.status).toBe('starting');
  });

  test('should check agent status', async () => {
    // First start a session
    await agentStart.handle(mockContext, {
      instructions: 'Go to example.com and click the first link.',
      apiKey: 'fake-api-key'
    });

    // Then check its status
    const statusResult = await agentStatus.handle(mockContext, {
      waitSeconds: 1
    });

    const statusResultText = statusResult.content[0].type === 'text' ? statusResult.content[0].text : '';
    const statusObj = JSON.parse(statusResultText);

    console.log('Status object:', statusObj);
    expect(['starting', 'running', 'completed', 'error']).toContain(statusObj.status);
    expect(statusObj.runningTime).toBeDefined();
  });

  test('should end an agent session', async () => {
    // First start a session
    await agentStart.handle(mockContext, {
      instructions: 'Go to example.com and click the first link.',
      apiKey: 'fake-api-key'
    });

    // Then end it
    const endResult = await agentEnd.handle(mockContext, {});

    const endResultText = endResult.content[0].type === 'text' ? endResult.content[0].text : '';
    const endObj = JSON.parse(endResultText);

    expect(endObj.status).toBe('completed');
    expect(endObj.message).toBe('Session forcefully ended');
  });

  test('should get agent logs', async () => {
    // First start a session
    await agentStart.handle(mockContext, {
      instructions: 'Go to example.com and click the first link.',
      apiKey: 'fake-api-key'
    });

    // Then get its logs
    const logResult = await agentLog.handle(mockContext, {
      includeImages: false
    });

    // Log format has changed, now we get a list of text messages
    expect(logResult.content.length).toBeGreaterThan(0);
    expect(logResult.content.some(item => item.type === 'text')).toBe(true);
  });

  test('should handle errors when no session is active', async () => {
    // End any active session first
    await agentEnd.handle(mockContext, {}).catch(() => {});
    
    // Try to get status when no session is active
    const statusResult = await agentStatus.handle(mockContext, {
      waitSeconds: 1
    });

    expect(statusResult.isError).toBe(true);
    const statusText = statusResult.content[0].type === 'text' ? statusResult.content[0].text : '';
    const statusObj = JSON.parse(statusText);
    expect(statusObj.error).toBe('No active session found');
  });
});