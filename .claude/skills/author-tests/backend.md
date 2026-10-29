# Backend playbook

Express 5, Prisma, zod, Vitest, supertest. No database is needed for unit tests.

- Tests live in `backend/tests/<module>.test.ts`. One file per module under test; amend it if it exists.
- Import from source with the `.ts` extension: `../src/features/todos/router.ts`.
- Shared data comes from `backend/tests/fixture.ts` (`record` is the database row, `todo` the API shape). Extend the fixture only by spreading: `{ ...todo, completed: true }`.
- Import `describe`, `it`, `expect`, `vi` from `vitest`.

## By kind of Unit
- **Router or route**: build an app as `setup()` does in `router.test.ts`: `express.json()`, then `createTodosRouter(repository)` with a fake repository of `vi.fn()` methods. Call it with `supertest`. Assert status, body, and that the repository was or was not called.
- **Repository**: stub the `PrismaClient` methods with `vi.spyOn` as in `repository.test.ts`. Assert the arguments passed to Prisma and the mapped result. Never connect to a database.
- **Validators and mappers**: call the zod schema or mapper directly. Use `it.each` for lists of valid and invalid input, and test the exact limits (120 and 121 characters, and so on). These two files must stay at 100%, see `backend/vitest.config.ts`.
- **Config, startup, health**: set `process.env` inside the test and restore it after; stub collaborators with `vi.fn()`.

## Conventions
- Dates: compare ISO strings; fix "today" with `vi.useFakeTimers()` and `vi.setSystemTime(...)`, and restore with `vi.useRealTimers()` in `afterEach`.
- Error responses are 422 for validation and 404 for a missing id; check the status and the body shape in `backend/openapi.json`.
- Run with `.github/scripts/agent/sandbox.sh test backend <file>`.
