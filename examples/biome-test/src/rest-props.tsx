// rest-props-rename.grit test cases
// Line 3: ✅ should flag — ...props rest binding
// Line 6+: ❌ should NOT flag — non-"props" rest bindings

import React from "react";

// ✅ Should flag: rest binding named "props"
function Component({ ...props }: { [key: string]: unknown }) {
  return <div {...props} />;
}

// ❌ Should NOT flag: rest binding named "rest"
function Widget({ ...rest }: { [key: string]: unknown }) {
  return <div {...rest} />;
}

// ❌ Should NOT flag: rest binding named "other"
function Helper({ ...other }: { [key: string]: unknown }) {
  return <div {...other} />;
}
