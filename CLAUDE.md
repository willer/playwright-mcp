# Playwright MCP Project Guidelines

## Build & Test Commands
- Build: `npm run build` - Compiles TypeScript files
- Watch: `npm run watch` - Runs TypeScript compiler in watch mode
- Lint: `npm run lint` - Runs ESLint on all files
- Test: `npm run test` - Runs all Playwright tests
- Single test: `npx playwright test tests/file.spec.ts -g "test name"` 

## Code Style Guidelines
- Indentation: 2 spaces
- Use single quotes for strings
- Semicolons are required
- Maximum 2 consecutive empty lines
- Arrow function spacing: `() => {}`
- TypeScript with strict mode enabled
- Explicit return types and parameter types
- Prefer `const` over `let` when possible
- No `var`, use `const`/`let` instead
- Copyright notice required at top of files
- ES modules with CommonJS output

## Error Handling
- Use custom error classes with descriptive messages
- Throw specific errors and catch appropriately
- Always handle promise rejections

## Testing Standards
- Use Playwright Test framework
- Create detailed test descriptions
- Use custom fixtures for test setup
- Test expectations with `expect().toEqual()` pattern