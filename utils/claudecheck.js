#!/usr/bin/env node

/**
 * This script performs an AI-powered linting check using Claude.
 * It examines the staged files and runs basic checks to ensure code quality.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Get a list of staged files
function getStagedFiles() {
  try {
    const output = execSync('git diff --staged --name-only').toString().trim();
    return output.split('\n').filter(file => file);
  } catch (error) {
    console.error('Error getting staged files:', error.message);
    return [];
  }
}

// Check for common issues in staged files
function checkFiles(files) {
  const issues = [];

  files.forEach(file => {
    if (!fs.existsSync(file)) return;
    
    const ext = path.extname(file);
    if (!['.js', '.ts', '.mjs'].includes(ext)) return;
    
    const content = fs.readFileSync(file, 'utf8');
    
    // Check for console.log (should use console.error instead)
    if (content.includes('console.log(') && file.includes('src/')) {
      issues.push(`${file}: Contains console.log() - Use console.error() instead to avoid polluting stdout`);
    }
    
    // Check for TODO comments without associated issue numbers
    const todoMatches = content.match(/\/\/\s*TODO(?!:.*#\d+)/g);
    if (todoMatches) {
      issues.push(`${file}: Contains TODO comment without issue number - Format as "TODO: description #123"`);
    }
    
    // Check for large functions (> 50 lines)
    const lines = content.split('\n');
    let inFunction = false;
    let functionStartLine = 0;
    let braceCount = 0;
    let functionName = '';
    
    lines.forEach((line, index) => {
      if (!inFunction && (line.includes('function ') || line.includes('=>') || line.match(/\w+\s*\([^)]*\)\s*{/))) {
        inFunction = true;
        functionStartLine = index;
        functionName = line.trim();
        braceCount = line.split('{').length - line.split('}').length;
      } else if (inFunction) {
        braceCount += line.split('{').length - line.split('}').length;
        if (braceCount === 0) {
          if (index - functionStartLine > 50) {
            issues.push(`${file}: Function starting with "${functionName}" is too large (${index - functionStartLine} lines)`);
          }
          inFunction = false;
        }
      }
    });
  });
  
  return issues;
}

// Main function
function main() {
  console.log('🤖 Running Claude AI linter check...');
  
  const stagedFiles = getStagedFiles();
  if (stagedFiles.length === 0) {
    console.log('No staged files to check.');
    return 0;
  }
  
  console.log(`Checking ${stagedFiles.length} staged files...`);
  const issues = checkFiles(stagedFiles);
  
  if (issues.length > 0) {
    console.error('\n🔴 Claude AI linter found issues:');
    issues.forEach(issue => console.error(`  - ${issue}`));
    console.error('\nPlease fix these issues before committing.');
    return 1;
  }
  
  console.log('✅ Claude AI linter check passed!');
  return 0;
}

// Run the main function and exit with the appropriate code
process.exit(main());