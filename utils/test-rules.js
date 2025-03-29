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
      description: 'Enforce proper testing practices',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: null,
    schema: [],
  },
  create(context) {
    return {
      // Detect test skipping or only focusing
      'CallExpression[callee.object.name="test"][callee.property.name=/skip|only/]': function(node) {
        context.report({
          node,
          message: 'Do not use test.skip() or test.only(). Fix the underlying issue instead.'
        });
      },
      
      // Detect test skipping with xit or xdescribe
      'CallExpression[callee.name=/^(xit|xdescribe|xtest|it\.skip|describe\.skip)$/]': function(node) {
        context.report({
          node,
          message: 'Do not use xit(), xdescribe(), xtest(), it.skip() or describe.skip(). Fix the underlying issue instead.'
        });
      },
      
      // Detect try-catch blocks that suppress test failures
      'TryStatement': function(node) {
        if (context.getFilename().includes('/tests/')) {
          const catchClause = node.handler;
          
          if (catchClause) {
            // Check if the catch block is hiding test failures by checking for common assertions
            const catchBody = catchClause.body.body;
            const hasForcedAssertion = catchBody.some(statement => 
              statement.type === 'ExpressionStatement' && 
              statement.expression.type === 'CallExpression' &&
              statement.expression.callee.property && 
              ['toBe', 'toEqual', 'toBeUndefined', 'toBeTruthy', 'toBeFalsy'].includes(statement.expression.callee.property.name)
            );
            
            if (hasForcedAssertion) {
              context.report({
                node,
                message: 'Do not use try-catch to hide test failures. Fix the underlying issue instead.'
              });
            }
          }
        }
      },
      
      // Detect hardcoded timeouts in tests
      'CallExpression[callee.name="setTimeout"]': function(node) {
        if (context.getFilename().includes('/tests/')) {
          context.report({
            node,
            message: 'Avoid using setTimeout in tests. Use test.setTimeout() or expect() with proper timeouts instead.'
          });
        }
      },
      
      // Detect commented-out tests
      'Program': function(node) {
        if (context.getFilename().includes('/tests/')) {
          const comments = context.getSourceCode().getAllComments();
          
          for (const comment of comments) {
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
        }
      }
    };
  }
};