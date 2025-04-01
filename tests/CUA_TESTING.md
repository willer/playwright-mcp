# Computer Use Agent (CUA) Testing Guide

This guide explains how to test the Computer Use Agent implementation without relying on the MCP protocol, which can introduce timeout and complexity issues.

## Internal Testing Approach

The `cua-internal-test.spec.ts` test suite demonstrates how to test CUA functions directly, bypassing MCP timeouts and protocol limitations.

### Key Testing Files:

1. `tests/cua-internal-test.spec.ts` - Main test suite that exercises CUA internals
2. `src/tools/cua/agent-internal.ts` - Exposes internal CUA functions for testing

### Test Structure:

The test suite provides various tests to validate CUA components:

1. **Basic Computer Functions**
   - Tests browser actions like screenshot, click, type
   - Validates navigation handling
   - Tests error recovery

2. **Message and Tool Call Handling**
   - Tests processing of message items
   - Tests processing of tool_call items
   - Validates conversion to tool_result format

3. **Conversation Flow**
   - Tests complete multi-step conversations
   - Validates proper state tracking
   - Tests tool call/result ID matching

4. **Multi-turn Conversations**
   - Tests continuing conversations with user replies
   - Validates context preservation
   - Ensures proper handling of sequential actions

## Testing Benefits

1. **No Timeouts**: Tests don't depend on real API calls that might exceed MCP timeouts
2. **Controlled Environment**: All external dependencies are mocked
3. **Isolated Testing**: Test specific components without MCP protocol overhead
4. **Fast Execution**: Tests run quickly without waiting for real API responses

## How to Run Tests

```bash
# Run all CUA internal tests
npx playwright test tests/cua-internal-test.spec.ts

# Run a specific test
npx playwright test tests/cua-internal-test.spec.ts:81 # Replace with line number
```

## Adding New Tests

To add new tests:

1. Add test cases to `tests/cua-internal-test.spec.ts`
2. Create mocks for any required responses
3. Use the exposed internal functions from `agent-internal.ts`
4. Focus on testing specific behavior rather than end-to-end flows

## Design Principles

The internal testing approach follows these principles:

1. **Mock External Dependencies**: Create mock responses for the OpenAI API
2. **Verify State Changes**: Check that actions execute correctly
3. **Validate Conversation Structure**: Ensure proper message and tool call handling
4. **Test Edge Cases**: Include error handling and recovery scenarios

This approach allows thorough testing of CUA implementation without external dependencies.