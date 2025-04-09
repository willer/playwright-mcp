#!/usr/bin/env node

/**
 * This script sets up Git hooks for the project
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get the Git hooks directory
const gitHooksDir = path.join(process.cwd(), '.git', 'hooks');

// Create pre-commit hook content
const preCommitContent = `#!/bin/sh

# Run lint-staged to check staged files
echo "Running lint-staged..."
npx lint-staged

# Run build to check TypeScript
echo "Running TypeScript build..."
npm run build || exit 1

# Run AI linter
echo "Running AI linter..."
npm run claudecheck || exit 1

echo "Pre-commit checks passed! ✅"
`;

// Write pre-commit hook
const preCommitPath = path.join(gitHooksDir, 'pre-commit');
fs.writeFileSync(preCommitPath, preCommitContent);

// Make it executable
try {
  execSync(`chmod +x ${preCommitPath}`);
  console.log('✅ Git pre-commit hook set up successfully.');
} catch (error) {
  console.error('❌ Error making pre-commit hook executable:', error.message);
  process.exit(1);
}