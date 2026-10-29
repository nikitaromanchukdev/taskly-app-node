## Add `truncate` helper

Adds `truncate(text, max)` in `backend/src/core/truncate.ts`, for shortening long text in log lines.

Intended behaviour:
- Text of at most `max` characters is returned unchanged. Text of exactly `max` characters is NOT shortened.
- Longer text is cut so the result is exactly `max` characters: the first `max - 1` characters followed by `…`.
- `max` below 1 throws a `RangeError`.
