# Frontend playbook

React 19, TanStack Query 5, styled-components, Vitest, jsdom, React Testing Library.

- Tests sit next to the source: `X.tsx` gets `X.test.tsx`; plain modules get `X.test.ts`.
- Setup is global (`src/test/setup.ts`: jest-dom matchers, auto cleanup). Do not repeat it.
- Shared data: `src/test/todoFixture.ts` (`todoFixture`). Spread it to vary a field.
- Imports in this package have no file extension and no semicolons: match the neighbouring file.

## By kind of Unit
- **Component**: mock the design system as the other component tests do, with `vi.mock('../../../design-system', () => import('../../../design-system/mocks'))` (adjust the relative path). Render with `render`, query by role and accessible name (`getByRole('button', { name: ... })`), and drive it with `userEvent.setup()`. Assert on what the user sees and on the callback props (`vi.fn()`).
- **Hook**: use `renderHook` from `@testing-library/react` inside a `QueryClientProvider` with a fresh `QueryClient` per test (`retry: false`). Mock the API module with `vi.mock` and assert on `result.current` via `waitFor`.
- **API client and `lib/http.ts`**: stub `fetch` with `vi.stubGlobal('fetch', vi.fn())`; assert URL, method, body, and the error for a non-ok response. Restore with `vi.unstubAllGlobals()`.
- **Pure utils** (`utils/todos.ts`): call directly; use `it.each` for boundaries.

## Conventions
- Prefer `getByRole` over test ids. Use `findBy*` or `waitFor` for async results; no fixed sleeps.
- Do not assert on styled-components class names.
- Run with `.github/scripts/sandbox.sh test frontend <file>`.
