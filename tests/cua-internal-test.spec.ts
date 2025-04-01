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

import { test, expect } from '@playwright/test';
import * as crypto from 'crypto';
import { PlaywrightComputer } from '../src/tools/cua/computer';
import { createResponse, handleItem, runComputerAgent } from '../src/tools/cua/agent-internal';

// Create a small separate module to expose the internal functions for testing
// This avoids the need to modify the original module
import '../src/tools/cua/agent-internal';

// Create test context for CUA functions
type MockContext = {
  createPage: () => Promise<any>;
};

// Create mock implementations
test.describe('CUA Internal Functions Test', () => {
  // Create mocks for the PlaywrightComputer
  let mockPage: any;
  let mockComputer: any;
  let mockContext: MockContext;
  let mockSessionId: string;
  
  test.beforeEach(() => {
    // Setup mock page with required methods
    mockPage = {
      mouse: {
        click: async () => {},
        dblclick: async () => {},
        move: async () => {},
        down: async () => {},
        up: async () => {},
        wheel: async () => {},
      },
      keyboard: {
        type: async () => {},
        press: async () => {},
      },
      screenshot: async () => Buffer.from('fake-screenshot-data'),
      viewportSize: () => ({ width: 1280, height: 720 }),
      url: () => 'https://example.com',
      goto: async () => {},
      setContent: async () => {},
    };
    
    // Create mock context
    mockContext = {
      createPage: async () => mockPage,
    };
    
    // Create a real computer instance with the mock context
    mockComputer = new PlaywrightComputer(mockContext as any);
    
    // Generate a mock session ID
    mockSessionId = crypto.randomUUID();
  });
  
  test('PlaywrightComputer screenshot works', async () => {
    // Test that screenshot functionality works
    const screenshot = await mockComputer.screenshot();
    expect(typeof screenshot).toBe('string');
    expect(screenshot).toBe('ZmFrZS1zY3JlZW5zaG90LWRhdGE='); // Base64 of 'fake-screenshot-data'
  });
  
  test('PlaywrightComputer basic actions work', async () => {
    // Mock the mouse click and track calls
    let clickCalled = false;
    mockPage.mouse.click = async () => { clickCalled = true; };
    
    // Test click action
    await mockComputer.click(100, 200);
    expect(clickCalled).toBe(true);
    
    // Mock the keyboard type and track calls
    let typeCalled = false;
    let typeText = '';
    mockPage.keyboard.type = async (text: string) => { 
      typeCalled = true;
      typeText = text;
    };
    
    // Test type action
    await mockComputer.type('Hello World');
    expect(typeCalled).toBe(true);
    expect(typeText).toBe('Hello World');
    
    // Test navigate action
    let gotoCalled = false;
    let gotoUrl = '';
    mockPage.goto = async (url: string) => {
      gotoCalled = true;
      gotoUrl = url;
    };
    
    await mockComputer.navigate('example.org');
    expect(gotoCalled).toBe(true);
    expect(gotoUrl).toBe('https://example.org');
  });
  
  test('PlaywrightComputer handles navigation errors gracefully', async () => {
    // Mock a failed navigation
    let setContentCalled = false;
    mockPage.goto = async () => { throw new Error('Navigation failed'); };
    mockPage.setContent = async () => { setContentCalled = true; };
    
    // Should not throw but create an error page
    await mockComputer.navigate('example.org');
    expect(setContentCalled).toBe(true);
  });
  
  test('handleItem processes message items correctly', async () => {
    // We need access to the internal function handleItem, but it's currently not exported
    // For this test, we'll need to modify the agent.ts file to export it or create a test-only version
    // Here we'll assume it's available through our agent-internal module
    
    // Create a mock session storage
    const mockActiveSessions = new Map();
    mockActiveSessions.set(mockSessionId, {
      sessionId: mockSessionId,
      computer: mockComputer,
      status: 'running',
      startTime: Date.now(),
      logs: [],
      images: [],
      items: []
    });
    
    // Mock message item
    const messageItem = {
      type: 'message',
      content: [{ text: 'Test message' }]
    };
    
    // Test handling a message item
    const messageResult = await handleItem(messageItem, mockComputer, mockSessionId, mockActiveSessions);
    expect(messageResult).toEqual([]);
    
    // Get the session and check logs
    const session = mockActiveSessions.get(mockSessionId);
    expect(session.logs).toContain('Message: Test message');
  });
  
  test('handleItem processes tool_call items correctly', async () => {
    // Create a mock session storage
    const mockActiveSessions = new Map();
    mockActiveSessions.set(mockSessionId, {
      sessionId: mockSessionId,
      computer: mockComputer,
      status: 'running',
      startTime: Date.now(),
      logs: [],
      images: [],
      items: []
    });
    
    // Mock tool_call item for a click action
    const toolCallItem = {
      type: 'tool_call',
      id: 'tool_call_1234',
      function: {
        name: 'computer',
        arguments: JSON.stringify({
          action: {
            type: 'click',
            x: 100,
            y: 200
          }
        })
      }
    };
    
    // Track if click was called
    let clickCalled = false;
    let clickX = 0;
    let clickY = 0;
    mockPage.mouse.click = async (x: number, y: number) => { 
      clickCalled = true;
      clickX = x;
      clickY = y;
    };
    
    // Test handling a tool_call item
    const toolCallResult = await handleItem(toolCallItem, mockComputer, mockSessionId, mockActiveSessions);
    expect(toolCallResult.length).toBeGreaterThan(0);
    expect(toolCallResult[0].type).toBe('tool_result');
    expect(toolCallResult[0].tool_call_id).toBe('tool_call_1234');
    
    // Check that the click action was executed
    expect(clickCalled).toBe(true);
    expect(clickX).toBe(100);
    expect(clickY).toBe(200);
  });
  
  test('mock runComputerAgent flow', async () => {
    // Since we can't actually call the OpenAI API in tests, we'll create a minimal
    // mock to test the high-level session management flow
    
    // Create mock for API interaction
    const mockCreateResponse = async (kwargs: any) => {
      // Return a mock response that contains a message to end the loop
      return {
        output: [
          {
            role: 'assistant',
            content: 'I completed the task successfully.'
          }
        ]
      };
    };
    
    // Create a mock session storage
    const mockActiveSessions = new Map();
    mockActiveSessions.set(mockSessionId, {
      sessionId: mockSessionId,
      computer: mockComputer,
      status: 'running',
      startTime: Date.now(),
      logs: [],
      images: [],
      items: [{ role: 'user', content: 'Test instruction' }]
    });
    
    // Run the agent with our mocks
    await runComputerAgent(
      mockSessionId, 
      mockComputer, 
      'Test instruction', 
      mockActiveSessions, 
      mockCreateResponse
    );
    
    // Get the session and check its status
    const session = mockActiveSessions.get(mockSessionId);
    expect(session.status).toBe('completed');
    expect(session.endTime).toBeDefined();
    expect(session.runningTime).toBeDefined();
    
    // Check that items were added correctly
    expect(session.items.length).toBeGreaterThan(1);
    expect(session.items[session.items.length - 1].role).toBe('assistant');
  });
  
  test('simulates a complete conversation with tool calls and replies', async () => {
    // Create more sophisticated mock responses for a multi-turn conversation
    let responseCount = 0;
    const mockCreateResponse = async (kwargs: any) => {
      responseCount++;
      
      // First response: tool call to click
      if (responseCount === 1) {
        return {
          output: [
            {
              type: 'tool_call',
              id: 'tool_call_click_1',
              function: {
                name: 'computer',
                arguments: JSON.stringify({
                  action: {
                    type: 'click',
                    x: 100,
                    y: 200
                  }
                })
              }
            }
          ]
        };
      }
      
      // Second response: tool call to type
      if (responseCount === 2) {
        return {
          output: [
            {
              type: 'tool_call',
              id: 'tool_call_type_1',
              function: {
                name: 'computer',
                arguments: JSON.stringify({
                  action: {
                    type: 'type',
                    text: 'Hello world'
                  }
                })
              }
            }
          ]
        };
      }
      
      // Third response: final message
      return {
        output: [
          {
            role: 'assistant',
            content: 'I have completed all the requested actions.'
          }
        ]
      };
    };
    
    // Track executed actions
    let clickExecuted = false;
    let typeExecuted = false;
    let typeText = '';
    
    // Create mock actions
    mockPage.mouse.click = async () => { clickExecuted = true; };
    mockPage.keyboard.type = async (text: string) => { 
      typeExecuted = true; 
      typeText = text;
    };
    
    // Create a mock session storage
    const mockActiveSessions = new Map();
    mockActiveSessions.set(mockSessionId, {
      sessionId: mockSessionId,
      computer: mockComputer,
      status: 'running',
      startTime: Date.now(),
      logs: [],
      images: [],
      items: []
    });
    
    // Run the agent with our mocks
    await runComputerAgent(
      mockSessionId, 
      mockComputer, 
      'Please click and type something', 
      mockActiveSessions, 
      mockCreateResponse
    );
    
    // Get the session and check its status
    const session = mockActiveSessions.get(mockSessionId);
    expect(session.status).toBe('completed');
    
    // Verify the actions were executed
    expect(clickExecuted).toBe(true);
    expect(typeExecuted).toBe(true);
    expect(typeText).toBe('Hello world');
    
    // Verify the conversation flow
    const items = session.items;
    
    // Find all the important items in the conversation
    const toolCalls = items.filter((item: any) => item.type === 'tool_call');
    const toolResults = items.filter((item: any) => item.type === 'tool_result');
    const messages = items.filter((item: any) => item.role === 'assistant' || item.role === 'user');
    
    // Verify the conversation structure
    expect(toolCalls.length).toBe(2); // Two tool calls
    expect(toolResults.length).toBe(2); // Two tool results
    expect(messages.length).toBe(2); // Initial user message + final assistant message
    
    // Check IDs match between tool_calls and tool_results
    const toolCallId1 = toolCalls[0].id;
    const toolCallId2 = toolCalls[1].id;
    const resultId1 = toolResults[0].tool_call_id;
    const resultId2 = toolResults[1].tool_call_id;
    
    expect(toolCallId1).toBe('tool_call_click_1');
    expect(toolCallId2).toBe('tool_call_type_1');
    expect(resultId1).toBe('tool_call_click_1');
    expect(resultId2).toBe('tool_call_type_1');
    
    // Check final message
    const finalMessage = messages[messages.length - 1];
    expect(finalMessage.role).toBe('assistant');
    expect(finalMessage.content).toBe('I have completed all the requested actions.');
  });
  
  test('simulates a multi-turn conversation by collecting results from both turns', async () => {
    // Create a special mock functions for the internal agentReply
    // First imported from the internal modules we're testing
    
    // Track internal state for test
    let conversationState = 'initial';
    let navigateExecuted = false;
    let clickExecuted = false;
    
    // Create mock actions
    mockPage.mouse.click = async () => { clickExecuted = true; };
    mockPage.goto = async (url: string) => { 
      navigateExecuted = true;
    };
    
    // Mock function that creates different responses based on the conversation state
    const mockCreateResponse = async (kwargs: any) => {
      const items = kwargs.input;
      const lastItem = items[items.length - 1];
      
      // Check if this is an initial instruction or a follow-up
      const isInitialNavigate = lastItem && 
                              lastItem.role === 'user' && 
                              lastItem.content.includes('navigate');
      
      const isClickFollowUp = lastItem && 
                            lastItem.role === 'user' && 
                            lastItem.content.includes('click');
      
      if (isInitialNavigate && conversationState === 'initial') {
        // First conversation - return a navigate action
        conversationState = 'navigated';
        return {
          output: [
            {
              type: 'tool_call',
              id: 'tool_call_navigate_1',
              function: {
                name: 'computer',
                arguments: JSON.stringify({
                  action: {
                    type: 'navigate',
                    url: 'https://example.com'
                  }
                })
              }
            },
            {
              role: 'assistant',
              content: 'I navigated to example.com'
            }
          ]
        };
      } else if (isClickFollowUp && conversationState === 'navigated') {
        // Second conversation - return a click action
        conversationState = 'clicked';
        return {
          output: [
            {
              type: 'tool_call',
              id: 'tool_call_click_1',
              function: {
                name: 'computer',
                arguments: JSON.stringify({
                  action: {
                    type: 'click',
                    x: 100,
                    y: 200
                  }
                })
              }
            },
            {
              role: 'assistant',
              content: 'I clicked at position 100, 200'
            }
          ]
        };
      } else {
        // Fallback response
        return {
          output: [
            {
              role: 'assistant',
              content: 'I\'m not sure what to do next.'
            }
          ]
        };
      }
    };
    
    // Create a storage for both turn's items so we can validate the full conversation
    const allItems: any[] = [];
    
    // First turn - navigation
    // ======================
    
    // Create mock session storage for first turn
    const mockActiveSessions = new Map();
    const firstSession = {
      sessionId: mockSessionId,
      computer: mockComputer,
      status: 'running',
      startTime: Date.now(),
      logs: [],
      images: [],
      items: []
    };
    mockActiveSessions.set(mockSessionId, firstSession);
    
    // Run the initial agent
    await runComputerAgent(
      mockSessionId, 
      mockComputer, 
      'Please navigate to example.com', 
      mockActiveSessions, 
      mockCreateResponse
    );
    
    // Verify the navigation was executed
    expect(navigateExecuted).toBe(true);
    
    // Save items from the first turn
    allItems.push(...firstSession.items);
    
    // Second turn - clicking
    // =====================
    
    // Create new session object for the second turn
    const secondSession = {
      sessionId: mockSessionId,
      computer: mockComputer,
      status: 'running',
      startTime: Date.now(),
      logs: [],
      images: [],
      items: [{ role: 'user', content: 'Now please click at position 100, 200' }]
    };
    
    // For testing purposes, we simulate a completely new turn
    mockActiveSessions.set(mockSessionId, secondSession);
    
    // Run the second turn
    await runComputerAgent(
      mockSessionId,
      mockComputer,
      'Now please click at position 100, 200',
      mockActiveSessions,
      mockCreateResponse
    );
    
    // Verify the click was executed
    expect(clickExecuted).toBe(true);
    
    // Save items from the second turn
    allItems.push(...secondSession.items);
    
    // Analyze the combined conversation
    // ===============================
    
    // Count the different message types
    const userMessages = allItems.filter((item: any) => item.role === 'user');
    const assistantMessages = allItems.filter((item: any) => item.role === 'assistant');
    const toolCalls = allItems.filter((item: any) => item.type === 'tool_call');
    const toolResults = allItems.filter((item: any) => item.type === 'tool_result');
    
    // We should have a user message in each turn
    expect(userMessages.length).toBeGreaterThanOrEqual(1);
    
    // We should have assistant messages in both turns
    expect(assistantMessages.length).toBeGreaterThanOrEqual(1);
    
    // We should have tool calls for both navigate and click
    const navigateToolCalls = toolCalls.filter(tc => 
      tc.function && tc.function.arguments && tc.function.arguments.includes('navigate')
    );
    const clickToolCalls = toolCalls.filter(tc => 
      tc.function && tc.function.arguments && tc.function.arguments.includes('click')
    );
    
    expect(navigateToolCalls.length).toBe(1);
    expect(clickToolCalls.length).toBe(1);
    
    // We should have tool results for both actions
    expect(toolResults.length).toBe(2);
    
    // One action from each turn was executed
    expect(navigateExecuted).toBe(true);
    expect(clickExecuted).toBe(true);
    
    // The conversation followed the expected flow
    expect(conversationState).toBe('clicked');
  });
});