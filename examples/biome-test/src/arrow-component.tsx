// arrow-component.grit test cases
// Line 3: ✅ should flag — uppercase arrow function component
// Line 5+: ❌ should NOT flag — non-component patterns

// ✅ Should flag: uppercase arrow function component
const MyComponent = () => <div>Hello</div>;

// ❌ Should NOT flag: Symbol (not an arrow function)
const GLOBAL_VAR = Symbol("___" as const);

// ❌ Should NOT flag: lowercase arrow function
const formatDate = () => new Date().toISOString();

// ❌ Should NOT flag: lowercase with underscore
const _private = () => {};
