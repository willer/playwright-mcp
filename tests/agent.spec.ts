/**
 * Tests for the Computer Use Agent (CUA) implementation.
 */
import { test, expect } from '@playwright/test';
import { agentStart, agentStatus, agentLog, agentEnd } from '../src/tools/agent-tools';
import { Context } from '../src/context';
import { chromium } from 'playwright';

// Mock the OpenAI API responses for testing
jest.mock('node-fetch', () => {
  return async () => {
    return {
      ok: true,
      json: async () => ({
        output: [
          {
            role: 'assistant',
            content: 'I have completed the task successfully.'
          }
        ]
      })
    };
  };
});

test.describe('CUA Agent Tests', () => {
  let mockContext: Context;
  
  test.beforeEach(async () => {
    // Set up mock context
    const browser = await chromium.launch();
    const browserContext = await browser.newContext();
    
    mockContext = {
      browserContext,
      request: null,
      response: null,
      log: jest.fn(),
    } as unknown as Context;
  });
  
  test('should start a new agent session', async () => {
    const result = await agentStart.handle(mockContext, { 
      instructions: 'Go to example.com and click the first link.' 
    });
    
    // Check that the result contains a session ID
    const resultText = result.content[0].type === 'text' ? result.content[0].text : '';
    const resultObj = JSON.parse(resultText);
    
    expect(resultObj.sessionId).toBeDefined();
    expect(resultObj.status).toBe('running');
  });
  
  test('should check agent status', async () => {
    // First start a session
    const startResult = await agentStart.handle(mockContext, { 
      instructions: 'Go to example.com and click the first link.' 
    });
    const startResultText = startResult.content[0].type === 'text' ? startResult.content[0].text : '';
    const { sessionId } = JSON.parse(startResultText);
    
    // Then check its status
    const statusResult = await agentStatus.handle(mockContext, { 
      sessionId, 
      waitSeconds: 1 
    });
    
    const statusResultText = statusResult.content[0].type === 'text' ? statusResult.content[0].text : '';
    const statusObj = JSON.parse(statusResultText);
    
    expect(statusObj.sessionId).toBe(sessionId);
    expect(['running', 'completed']).toContain(statusObj.status);
  });
  
  test('should end an agent session', async () => {
    // First start a session
    const startResult = await agentStart.handle(mockContext, { 
      instructions: 'Go to example.com and click the first link.' 
    });
    const startResultText = startResult.content[0].type === 'text' ? startResult.content[0].text : '';
    const { sessionId } = JSON.parse(startResultText);
    
    // Then end it
    const endResult = await agentEnd.handle(mockContext, { sessionId });
    
    const endResultText = endResult.content[0].type === 'text' ? endResult.content[0].text : '';
    const endObj = JSON.parse(endResultText);
    
    expect(endObj.sessionId).toBe(sessionId);
    expect(endObj.status).toBe('ended');
  });
  
  test('should get agent logs', async () => {
    // First start a session
    const startResult = await agentStart.handle(mockContext, { 
      instructions: 'Go to example.com and click the first link.' 
    });
    const startResultText = startResult.content[0].type === 'text' ? startResult.content[0].text : '';
    const { sessionId } = JSON.parse(startResultText);
    
    // Then get its logs
    const logResult = await agentLog.handle(mockContext, { 
      sessionId,
      includeImages: false
    });
    
    const logResultText = logResult.content[0].type === 'text' ? logResult.content[0].text : '';
    const logObj = JSON.parse(logResultText);
    
    expect(logObj.sessionId).toBe(sessionId);
    expect(logObj.logs).toBeDefined();
    expect(Array.isArray(logObj.logs)).toBe(true);
  });
  
  test('should handle errors gracefully', async () => {
    // Try to get status for a non-existent session
    const statusResult = await agentStatus.handle(mockContext, { 
      sessionId: 'non-existent-session-id', 
      waitSeconds: 1 
    });
    
    expect(statusResult.isError).toBe(true);
  });
});