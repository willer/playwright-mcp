#!/bin/bash

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Navigate to the playwright-mcp project directory
cd "$SCRIPT_DIR"

# Build the project to ensure it's up to date
npm run build

# Run the MCP server with vision mode
node lib/program.js vision

# Exit with the same status code as the node process
exit $?