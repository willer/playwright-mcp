#!/bin/sh
# Simple script to install the git hooks
cp hooks/pre-commit .git/hooks/
chmod +x .git/hooks/pre-commit
echo "Git hooks installed successfully!"