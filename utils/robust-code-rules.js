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
      description: 'Enforce robust coding practices throughout the codebase',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: null,
    schema: [],
  },
  create(context) {
    return {
      // Detect hardcoded domains or URLs that might suggest special-case handling
      'Literal[value=/example\.com|google\.com|amazon\.com|example\.org|localhost/]': function(node) {
        // Skip if in a test file - test files can have example domains
        if (context.getFilename().includes('/tests/')) {
          return;
        }
        
        // Skip if within import statements
        const parent = node.parent;
        if (parent && parent.type === 'ImportDeclaration') {
          return;
        }
        
        // Check if this is in documentation
        const sourceCode = context.getSourceCode();
        const comments = sourceCode.getCommentsInside(node);
        if (comments.some(comment => comment.value.includes('@example'))) {
          return;
        }
        
        context.report({
          node,
          message: 'Avoid hardcoded domain names or URLs. Use configuration or parameters instead.'
        });
      },

      // Detect empty catch blocks or ones that suppress errors
      'CatchClause': function(node) {
        const catchBody = node.body.body;
        
        // Empty catch block
        if (catchBody.length === 0) {
          context.report({
            node,
            message: 'Empty catch blocks suppress errors. Either handle the error or rethrow it.'
          });
          return;
        }
        
        // Check if the catch block properly handles or rethrows the error
        const errorHandling = catchBody.some(statement => 
          // Check for logging
          (statement.type === 'ExpressionStatement' && 
           statement.expression.type === 'CallExpression' &&
           statement.expression.callee.property && 
           ['log', 'error', 'warn', 'debug', 'info'].includes(statement.expression.callee.property.name)) ||
          // Check for rethrowing
          (statement.type === 'ThrowStatement') ||
          // Check for returning error state
          (statement.type === 'ReturnStatement' && 
           statement.argument && 
           statement.argument.properties && 
           statement.argument.properties.some(prop => 
             prop.key.name === 'isError' || 
             prop.key.name === 'error' ||
             prop.key.name === 'success' && prop.value.value === false))
        );
        
        if (!errorHandling) {
          context.report({
            node,
            message: 'Catch blocks should properly handle or rethrow errors. Silent error handling is discouraged.'
          });
        }
      },

      // Detect commented-out code
      'Program': function(node) {
        const comments = context.getSourceCode().getAllComments();
        
        for (const comment of comments) {
          // Skip license headers and documentation comments
          if (comment.value.includes('Copyright') || 
              comment.value.includes('@param') || 
              comment.value.includes('@returns') ||
              comment.value.includes('@example')) {
            continue;
          }
          
          // Look for comments that appear to contain code
          if (comment.value.includes('if (') || 
              comment.value.includes('function') || 
              comment.value.includes('= function') ||
              comment.value.includes('for (') ||
              comment.value.includes('console.log') ||
              comment.value.includes('return ') ||
              comment.value.match(/\w+\(.*\)/) ||
              comment.value.includes('new ')) {
            context.report({
              node: comment,
              message: 'Avoid commented out code. Either remove it or implement it properly.'
            });
          }
        }
      },

      // Check for special-case handling based on specific domain/service logic
      'IfStatement': function(node) {
        // Skip if in a test file
        if (context.getFilename().includes('/tests/')) {
          return;
        }
        
        const sourceCode = context.getSourceCode();
        const ifText = sourceCode.getText(node.test);
        
        if (ifText.includes('amazon') || 
            ifText.includes('google') || 
            ifText.includes('example.com') ||
            ifText.includes('.facebook.') || 
            ifText.includes('.twitter.') ||
            ifText.includes('.instagram.')) {
          context.report({
            node,
            message: 'Avoid website-specific logic. Code should be generic and configurable.'
          });
        }
      },
      
      // Identify use of setTimeout without cleanup
      'CallExpression[callee.name="setTimeout"]': function(node) {
        // Skip check in test files
        if (context.getFilename().includes('/tests/')) {
          return;
        }
        
        // Check if the setTimeout result is saved to a variable
        const parent = node.parent;
        if (parent.type !== 'VariableDeclarator' && 
            parent.type !== 'AssignmentExpression') {
          
          // Check for higher-level pattern like in Promise.race or similar
          const grandparent = parent.parent;
          if (grandparent && grandparent.type === 'ArrayExpression') {
            return;
          }
          
          context.report({
            node,
            message: 'Store setTimeout return value to allow cancellation, preventing memory leaks and ensuring cleanup.'
          });
        }
      },
      
      // Check for proper Promise error handling
      'CallExpression[callee.property.name="then"]': function(node) {
        // If there's only one argument to .then(), it means catch isn't being handled
        if (node.arguments.length === 1) {
          // Check if there's a .catch() call right after
          const parent = node.parent;
          if (parent.type === 'MemberExpression' && 
              parent.property.name === 'catch') {
            return;
          }
          
          // Check if it's part of a chain that eventually has .catch()
          let currentNode = node;
          let hasCatch = false;
          while (currentNode.parent && currentNode.parent.type === 'MemberExpression') {
            currentNode = currentNode.parent.parent;
            if (currentNode.type === 'CallExpression' && 
                currentNode.callee.property && 
                currentNode.callee.property.name === 'catch') {
              hasCatch = true;
              break;
            }
          }
          
          if (!hasCatch) {
            context.report({
              node,
              message: 'Promise chains should handle errors with .catch() or provide a rejection handler to .then()'
            });
          }
        }
      },
      
      // Ensure async/await has proper error handling
      'TryStatement': function(node) {
        // Check if the try block contains an await expression
        const hasAwait = context.getSourceCode().getText(node.block).includes('await ');
        
        if (hasAwait && !node.handler) {
          context.report({
            node,
            message: 'try blocks containing await expressions must have a catch clause'
          });
        }
      },
      
      // Ensure consistent error returns
      'ReturnStatement': function(node) {
        if (node.argument && 
            node.argument.type === 'ObjectExpression' && 
            node.argument.properties) {
          
          const properties = node.argument.properties;
          
          // If it includes an 'error' property, make sure it also has 'isError: true'
          const hasErrorProp = properties.some(prop => 
            prop.key && prop.key.name === 'error' && prop.value);
          
          const hasIsErrorProp = properties.some(prop => 
            prop.key && prop.key.name === 'isError' && 
            prop.value && prop.value.value === true);
          
          if (hasErrorProp && !hasIsErrorProp) {
            context.report({
              node,
              message: 'When returning an error object, include "isError: true" for consistent error handling'
            });
          }
        }
      }
    };
  }
};