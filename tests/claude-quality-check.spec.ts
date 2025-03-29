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
import { execSync } from 'child_process';

/**
 * Tests whether the code meets quality and compliance standards
 * using Claude to evaluate uncommitted changes against global requirements.
 */
test('code quality and compliance check with Claude', async ({ page }) => {
  // Set a longer timeout as Claude might take time to respond
  test.setTimeout(60000);
  
  let output: string;
  try {
    // Run Claude with the quality check prompt
    output = execSync(`claude -p "Please check uncommitted changes vs any global rules or requirements that you're aware of, and identify any deviations from those rules and requirements. Then say PASS or FAIL based on whether you think the code quality and compliance are good enough to allow a production launch."`, 
      { encoding: 'utf-8' });
    
    console.log('Claude quality check output:', output);
    
    // Check if the output contains PASS
    const isPassing = output.includes('PASS');
    
    // Output the result
    if (isPassing) {
      console.log('✅ Quality check passed');
    } else {
      console.log('❌ Quality check failed');
      // Extract any failure reasons (text between "FAIL" and the end)
      const failureIndex = output.indexOf('FAIL');
      if (failureIndex !== -1) {
        const failureReason = output.substring(failureIndex);
        console.log('Failure reasons:', failureReason);
      }
    }
    
    // The test should pass only if Claude output contains "PASS"
    expect(isPassing, 'Claude did not report PASS for code quality check').toBeTruthy();
    
  } catch (error: any) {
    console.error('Error running Claude quality check:', error.message);
    
    // If Claude CLI is not installed, suggest installation
    if (error.message.includes('command not found')) {
      console.error('Claude CLI not found. Please install it and ensure it\'s in your PATH.');
    }
    
    // Still fail the test
    expect(false, 'Failed to run Claude quality check: ' + error.message).toBeTruthy();
  }
});