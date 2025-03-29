# Robust Code & Testing Rules

This document explains our custom ESLint rules designed to enforce robust coding practices throughout the codebase.

## Philosophy

Our linting strategy is built around these principles:

1. **Robustness Over Workarounds**: Code should properly handle errors and corner cases, never silently suppressing them
2. **Test Integrity**: Tests should always run and pass, not be skipped or disabled
3. **Generic Over Specific**: Code should be configurable and not hardcode specific domains or services
4. **Clean Codebase**: No commented-out code or other code smells

## Robust Code Quality Rules (`robust/code-quality`)

These rules apply to all source code to ensure robust, maintainable, and reliable behavior.

### Enforced practices:

1. **No hardcoded domain names** - Using domain names like "amazon.com" or "example.com" directly in the code is prohibited. Use configuration or parameters instead.

2. **No silent error suppression** - Empty catch blocks or those that don't properly handle or rethrow errors are flagged.

3. **No commented-out code** - Code that has been commented out should be either properly implemented or removed entirely.

4. **No website-specific logic** - Conditional statements that check for specific websites are prohibited. Code should be generic and configurable.

5. **Proper resource cleanup** - All setTimeout calls should store their IDs to allow cancellation and prevent memory leaks.

6. **Promise error handling** - All Promises should include error handling through either `.catch()` or a second argument to `.then()`.

7. **Consistent error returns** - When returning error objects, include `isError: true` for consistent identification.

8. **Proper async/await handling** - All try blocks containing await expressions must have catch clauses.

## Robust Test Quality Rules (`robust/test-quality`)

These rules ensure that tests are properly maintained and never disabled or skipped.

### Enforced practices:

1. **No disabled tests** - The use of `test.skip()`, `test.only()`, `it.skip()`, `xdescribe()`, etc., is prohibited. Fix the underlying issue rather than disabling tests.

2. **No suppressed test failures** - Using try-catch blocks containing assertions is not allowed. Let tests fail for proper debugging.

3. **No arbitrary timeouts** - Avoid using `setTimeout()` in tests. Use the proper testing framework's timing mechanisms instead.

4. **No commented-out tests** - Tests that have been commented out should be either fixed or removed completely.

5. **No flaky tests** - Tests using setTimeout with random values must use fixed seeds to prevent flakiness.

6. **Clear test descriptions** - Test names should be specific and descriptive about what is being tested.

## Benefits

These rules help maintain code quality by ensuring:

1. **Reliability** - Errors are properly handled and reported, not silently ignored
2. **Robustness** - Code doesn't rely on specific services or contain special-case logic
3. **Testability** - All tests are executed and failures are not suppressed
4. **Maintainability** - No commented-out code or poor resource management

## Usage

Run the linting checks with these commands:

```bash
# Run all linting checks
npm run lint

# Fix automatically fixable issues
npm run lint:fix

# Check source code specifically
npm run lint:code

# Check test code specifically
npm run lint:tests

# Install pre-commit hook to enforce rules
npm run install-hooks
```

## Adding New Rules

To add new rules, modify the rule files in the `utils` directory:

- `robust-code-rules.js` - Rules for source code
- `robust-test-rules.js` - Rules for test code

Then update `eslint.config.mjs` to include your updates.