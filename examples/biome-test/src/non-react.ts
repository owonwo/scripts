// Non-React .ts file — plugins should NOT fire here
// All patterns below are valid in non-React TypeScript code

// ❌ Should NOT flag: uppercase arrow (not a component, .ts file)
const Logger = (msg: string) => console.log(msg);

// ❌ Should NOT flag: Symbol
const GLOBAL_VAR = Symbol("id");

// ❌ Should NOT flag: destructured props (not React)
function processUser({
  name,
  age,
  email,
  ...rest
}: {
  name: string;
  age: number;
  email: string;
  [key: string]: unknown;
}) {
  return { name, age, ...rest };
}

// ❌ Should NOT flag: inline type literal (not React)
function format(data: { key: string; value: number }) {
  return `${data.key}: ${data.value}`;
}

// ❌ Should NOT flag: rest binding named "props" (not React)
function merge({ ...props }: Record<string, unknown>) {
  return { ...props };
}
