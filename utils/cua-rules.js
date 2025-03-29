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
      description: 'Enforce proper practices in Computer Use Agent code',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: null,
    schema: [],
  },
  create(context) {
    return {
      // Detect hardcoded fallbacks or URL-specific handling
      'Literal[value=/amazon|google|example/]': function(node) {
        // Only report when in CUA files
        if (context.getFilename().includes('/src/tools/cua/')) {
          context.report({
            node,
            message: 'Avoid hardcoded domain names or fallback URLs in CUA code'
          });
        }
      },

      // Detect code patterns that would disable or skip tests
      'CallExpression[callee.name=/skip|only/]': function(node) {
        if (context.getFilename().includes('/tests/')) {
          context.report({
            node,
            message: 'Avoid disabling or skipping tests. Fix the underlying issue instead.'
          });
        }
      },

      // Detect try-catch blocks that silently suppress errors in CUA code
      'CatchClause': function(node) {
        if (context.getFilename().includes('/src/tools/cua/')) {
          const catchBody = node.body.body;
          
          // Check if the catch block properly handles the error
          const errorHandling = catchBody.some(statement => 
            statement.type === 'ExpressionStatement' && 
            statement.expression.type === 'CallExpression' &&
            statement.expression.callee.property && 
            statement.expression.callee.property.name === 'logToSession'
          );
          
          if (!errorHandling) {
            context.report({
              node,
              message: 'Always properly log errors in CUA code instead of silently handling them'
            });
          }
        }
      },

      // Detect commented-out code
      'Program': function(node) {
        const comments = context.getSourceCode().getAllComments();
        
        for (const comment of comments) {
          // Look for comments that appear to contain code
          if (comment.value.includes('if (') || 
              comment.value.includes('function') || 
              comment.value.includes('= function') ||
              comment.value.includes('for (') ||
              comment.value.includes('console.log')) {
            context.report({
              node: comment,
              message: 'Avoid commented out code. Remove it or implement it properly.'
            });
          }
        }
      },

      // Detect handling specific website logic in CUA code
      'IfStatement': function(node) {
        if (context.getFilename().includes('/src/tools/cua/')) {
          const sourceCode = context.getSourceCode();
          const ifText = sourceCode.getText(node.test);
          
          if (ifText.includes('amazon') || 
              ifText.includes('google') || 
              ifText.includes('example.com')) {
            context.report({
              node,
              message: 'Avoid website-specific logic in CUA code. It should be generic.'
            });
          }
        }
      }
    };
  }
};