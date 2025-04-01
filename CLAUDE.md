# Playwright MCP Development Guidelines

## Build/Test/Lint Commands
- Build: `npm run build` - Compiles TypeScript to JavaScript
- Lint: `npm run lint` - Runs ESLint on all files
- Test (all): `npm run test` - Runs all Playwright tests
- Test (single): `npx playwright test tests/basic.spec.ts` - Run specific test file
- Test (pattern): `npx playwright test -g "test description"` - Run tests matching pattern
- Watch mode: `npm run watch` - Watches for file changes and rebuilds
- Clean: `npm run clean` - Removes build artifacts

## Code Style Guidelines
- **Formatting**: 2-space indentation, single quotes, semicolons required
- **Imports**: Group imports by type (node modules, then local)
- **Types**: Use strict TypeScript types, prefer interfaces for public APIs
- **Naming**: camelCase for variables/functions, PascalCase for classes/interfaces
- **Classes**: Prefer composition over inheritance
- **Functions**: Use arrow functions for callbacks, named functions for exports
- **Error Handling**: Use try/catch for async operations, never swallow errors
- **Documentation**: Document public APIs with JSDoc comments

## CUA Implementation Requirements
- The implementation of CUA must exactly follow the example structures in `~/GitHub/openai-cua-sample-app/simple_cua_loop.py`
- Maintain proper session management and cleanup for browser resources
- Follow the communication flow defined in CUA_INTERFACE.md
- Ensure all API calls have proper error handling and timeouts