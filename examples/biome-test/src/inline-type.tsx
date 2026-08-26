// inline-type-literal.grit test cases
// Line 7: ✅ should flag — inline type literal on "props" param
// Line 12: ✅ should flag — inline type literal on any param (plugin can't filter by name)
// Line 21: ❌ should NOT flag — named type alias (not inline)

import React from "react";

// ✅ Should flag: inline type literal on param named "props"
function Component({ props }: { props: string }) {
  return <div>{props}</div>;
}

// ✅ Should flag: inline type literal on param NOT named "props"
// (known limitation: plugin flags all inline type literals)
function helper(x: { name: string }) {
  return x.name;
}

// ❌ Should NOT flag: named type alias (not inline)
interface Props {
  y: number;
}
function Widget({ y }: Props) {
  return <div>{y}</div>;
}
