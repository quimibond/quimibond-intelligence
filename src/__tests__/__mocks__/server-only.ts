// Vitest shim for the `server-only` package.
// In the test (jsdom) environment this package doesn't exist; exporting
// an empty module silences the import without affecting any logic.
export {};
