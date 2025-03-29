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

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce robust testing practices',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: null,
    schema: [],
  },
  create(context) {
    return {
      // Detect test skipping with test.skip or test.only
      'CallExpression[callee.object.name="test"][callee.property.name=/skip|only/]': function(node) {
        context.report({
          node,
          message: 'Do not use test.skip() or test.only(). Fix the underlying issue instead of skipping tests.'
        });
      },
      
      // Detect test skipping with xit, xdescribe, etc.
      'CallExpression[callee.name=/^(xit|xdescribe|xtest)$/]': function(node) {
        context.report({
          node,
          message: 'Do not use xit(), xdescribe(), or xtest(). Fix the underlying issue instead of skipping tests.'
        });
      },
      
      // Detect it.skip
      'CallExpression[callee.object.name="it"][callee.property.name="skip"]': function(node) {
        context.report({
          node,
          message: 'Do not use it.skip(). Fix the underlying issue instead of skipping tests.'
        });
      },
      
      // Detect describe.skip
      'CallExpression[callee.object.name="describe"][callee.property.name="skip"]': function(node) {
        context.report({
          node,
          message: 'Do not use describe.skip(). Fix the underlying issue instead of skipping tests.'
        });
      },
      
      // Detect test.todo - should be implemented or removed
      'CallExpression[callee.object.name="test"][callee.property.name="todo"]': function(node) {
        context.report({
          node,
          message: 'Do not use test.todo(). Implement the test or remove it.'
        });
      },
      
      // Detect hardcoded timeouts in tests
      'CallExpression[callee.name="setTimeout"]': function(node) {
        context.report({
          node,
          message: 'Avoid using setTimeout in tests. Use test.setTimeout() or expect() with proper timeouts instead.'
        });
      },
      
      // Detect commented-out tests
      'Program': function(node) {
        if (!context.getFilename().includes('/tests/')) {
          return;
        }
        
        const comments = context.getSourceCode().getAllComments();
        
        for (const comment of comments) {
          // Skip license headers and documentation comments
          if (comment.value.includes('Copyright') || 
              comment.value.includes('@param') || 
              comment.value.includes('@returns')) {
            continue;
          }
          
          // Look for comments that appear to contain test code
          if ((comment.value.includes('test(') || 
              comment.value.includes('it(') || 
              comment.value.includes('describe(')) && 
              comment.value.includes('expect(')) {
            context.report({
              node: comment,
              message: 'Avoid commented out tests. Either fix them or remove them completely.'
            });
          }
        }
      },
      
      // Check for assertions inside catch blocks
      'CatchClause': function(node) {
        const catchBody = node.body.body;
        
        // Check if any statements in the catch block contain assertions
        for (const statement of catchBody) {
          if (statement.type === 'ExpressionStatement' && 
              statement.expression.type === 'CallExpression') {
              
            const expression = statement.expression;
            
            // Check for expect().toX() patterns
            if (expression.callee.type === 'MemberExpression' && 
                expression.callee.object && 
                expression.callee.object.type === 'CallExpression' && 
                expression.callee.object.callee && 
                expression.callee.object.callee.name === 'expect') {
              
              context.report({
                node: statement,
                message: 'Avoid assertions in catch blocks. This may hide test failures. Let the test fail for proper debugging.'
              });
            }
          }
        }
      },
      
      // Detect flaky test patterns with setTimeout without fixed seeds
      'CallExpression[callee.name="test"]': function(node) {
        // Check if test contains both setTimeout and random number generation
        let hasTimeout = false;
        let hasRandom = false;
        let hasSeed = false;
        
        const checkNode = (innerNode) => {
          if (!innerNode || typeof innerNode !== 'object') {
            return;
          }
          
          if (innerNode.type === 'CallExpression') {
            // Check for setTimeout
            if (innerNode.callee.name === 'setTimeout') {
              hasTimeout = true;
            }
            
            // Check for Math.random
            if (innerNode.callee.type === 'MemberExpression' && 
                innerNode.callee.object.name === 'Math' && 
                innerNode.callee.property.name === 'random') {
              hasRandom = true;
            }
            
            // Check for seed setting
            if (innerNode.callee.type === 'MemberExpression' && 
                innerNode.callee.property.name === 'seed') {
              hasSeed = true;
            }
          }
          
          // Recursively check all child nodes
          for (const key in innerNode) {
            if (typeof innerNode[key] === 'object' && innerNode[key] !== null) {
              if (Array.isArray(innerNode[key])) {
                innerNode[key].forEach(checkNode);
              } else {
                checkNode(innerNode[key]);
              }
            }
          }
        };
        
        if (node.arguments.length > 0 && node.arguments[1]) {
          checkNode(node.arguments[1]);
        }
        
        if (hasTimeout && hasRandom && !hasSeed) {
          context.report({
            node,
            message: 'Test uses setTimeout and random values without fixed seeds. This may cause flaky tests.'
          });
        }
      },
      
      // Ensure test descriptions are clear and specific
      'CallExpression[callee.name="test"]': function(node) {
        if (node.arguments.length > 0 && 
            node.arguments[0].type === 'Literal' && 
            typeof node.arguments[0].value === 'string') {
          
          const testName = node.arguments[0].value;
          
          // Check for vague test names
          if (/^(test|should work|it works|check|verify)$/i.test(testName) || 
              testName.length < 10) {
            context.report({
              node: node.arguments[0],
              message: 'Test descriptions should be clear and specific about what is being tested'
            });
          }
        }
      }
    };
  }
};