// destructured-props-complex.grit test cases
// Line 3: ✅ should flag — 3+ destructured props with "props"
// Line 6+: ❌ should NOT flag — non-React patterns

import React from "react";

// ✅ Should flag: 3+ destructured props containing "props"
function Foo({
  a,
  b,
  c,
  ...props
}: {
  a: string;
  b: number;
  c: boolean;
  [key: string]: unknown;
}) {
  return <div>{props.b + 1}</div>;
}

// ❌ Should NOT flag: 4 params but no "props" name
function bar(a: string, b: number, c: boolean, d: string) {
  return a + b;
}

// ❌ Should NOT flag: 2 destructured props with "props" (less than 3)
function Baz({ a, ...props }: { a: string; [key: string]: unknown }) {
  return <div />;
}
