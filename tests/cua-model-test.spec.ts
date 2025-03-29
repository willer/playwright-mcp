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
 * This test validates that the CUA implementation is using the correct
 * OpenAI model (computer-use-preview) and Computer Use Preview API format,
 * not just simulating it with gpt-4o or other generic models.
 */

test('verify CUA uses correct model and API format', async ({ page }) => {
  // Variables to store our analysis results
  let usingCorrectModel = false;
  let usingComputerTools = false;
  let usingGpt4o = false;
  
  try {
    // Rather than intercept actual API calls, we'll directly examine the source code
    // to verify it's using the correct model and format
    
    // First, read the agent.ts file which contains the OpenAI API implementation
    const agentFile = path.join(process.cwd(), 'src', 'tools', 'cua', 'agent.ts');
    const agentCode = fs.readFileSync(agentFile, 'utf-8');

    // Check if the implementation is using the correct model
    usingCorrectModel = agentCode.includes("model: 'computer-use-preview'");
    
    // Check for tool definitions that would indicate proper Computer Use Preview API
    usingComputerTools = agentCode.includes('type: "computer-preview"') || 
                          agentCode.includes('type: \'computer-preview\'') ||
                          agentCode.match(/tools:\s*\[\s*\{\s*type:\s*['"]computer-preview['"]/s) !== null;
    
    // Check for gpt-4o (incorrect model)
    usingGpt4o = agentCode.includes("model: 'gpt-4o'") || 
                  agentCode.includes('model: "gpt-4o"') ||
                  agentCode.includes("model: 'gpt-4-turbo'") ||
                  agentCode.includes('model: "gpt-4-turbo"');
  
  // Print findings
  if (usingGpt4o) {
    console.error('TEST FAILED: Current implementation is using gpt-4o/gpt-4-turbo instead of computer-use-preview');
  }
  
  // Test assertions with proper error messages
  const modelErrorMsg = 'CUA implementation is NOT using the correct computer-use-preview model. ' +
    'The implementation appears to be using a different model. ' +
    'Update the model parameter in API calls to "computer-use-preview".';
  
  const toolsErrorMsg = 'CUA implementation is NOT using the proper computer tools format. ' +
    'Proper implementation should include tools with type "computer-preview" with ' +
    'the appropriate parameters. Use the proper Computer Use Agent API format as shown in the OpenAI sample code.';
    
  const gpt4ErrorMsg = 'Current implementation is incorrectly using gpt-4o or gpt-4-turbo model ' +
    'instead of computer-use-preview. This approach tries to simulate CUA ' +
    'capabilities with a generic model instead of using the actual Computer Use Agent API.';
  
  if (!usingCorrectModel) {
    console.error(modelErrorMsg);
    expect(usingCorrectModel).toBeTruthy();
  }
  
  if (!usingComputerTools) {
    console.error(toolsErrorMsg);
    expect(usingComputerTools).toBeTruthy();
  }
  
  if (usingGpt4o) {
    console.error(gpt4ErrorMsg);
    expect(usingGpt4o).toBeFalsy();
  }
  
  // Provide specific advice for fixing
  if (!usingCorrectModel || !usingComputerTools || usingGpt4o) {
    console.log('\nTo fix this issue:');
    console.log('1. Update the model to "computer-use-preview" in agent.ts');
    console.log('2. Use the proper Computer Use Agent API format:');
    console.log('   a. Use the /v1/responses endpoint instead of /v1/chat/completions');
    console.log('   b. Add required "tools" parameter with type "computer-preview"');
    console.log('   c. Follow the OpenAI sample code format for API requests');
    console.log('3. Follow the computer-use-preview model documentation');
    console.log('4. Reference examples in the sample code:');
    console.log('   - https://github.com/openai/openai-cua-sample-app');
    console.log('\nExample OpenAI Computer Use Agent request format:');
    console.log(`
{
  "model": "computer-use-preview",
  "input": [
    {"role": "user", "content": "Click the login button"}
  ],
  "truncation": "auto"
}
    `);
  }
  
  } catch (error) {
    console.error('Test error:', error);
    throw error;
  } finally {
    // Write a report file so the results are always visible
    const reportContent = `
CUA Implementation Test Report
-----------------------------
Using computer-use-preview model: ${usingCorrectModel ? 'YES ✅' : 'NO ❌'}
Using proper Computer-Preview tools API: ${usingComputerTools ? 'YES ✅' : 'NO ❌'}
Using incorrect gpt-4o model: ${usingGpt4o ? 'YES ❌' : 'NO ✅'}

Current implementation issues:
${!usingCorrectModel ? '- NOT using the computer-use-preview model ❌\n' : ''}
${usingGpt4o ? '- Using INCORRECT gpt-4o/gpt-4-turbo model ❌\n' : ''}
${!usingComputerTools ? '- NOT using proper computer-preview tools format ❌\n' : ''}

To fix these issues:
1. Update model to computer-use-preview
2. Use the /v1/responses endpoint
3. Implement proper tools with type: "computer-preview"

Reference the sample implementation:
- https://github.com/openai/openai-cua-sample-app
`;

    fs.writeFileSync(path.join(process.cwd(), 'cua-test-report.txt'), reportContent, 'utf-8');
    console.log('\nSaved detailed report to cua-test-report.txt');
  }
});
