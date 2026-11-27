# Checking locator-only step updates

From the repository root, install the pinned dependencies with `npm ci --ignore-scripts`
if needed. Compare the previous and updated JavaScript files or version directories:

```sh
bench/tools/diff-check path/to/before path/to/after
make -C bench test-p6tool
```

Directory inputs are compared by relative path, recursively, for `.js`, `.mjs` and
`.cjs` sources. Include any changed helpers and locator registries in the comparison.
The checker parses the sources without loading or running them. Exit status 0 means
the normalized syntax trees match, 1 means a difference was flagged for review, and
2 means the inputs could not be checked.

The comparison permits changes to string selectors in the supported locator calls,
literal `getByRole` names, and string values in the shared `locators.mjs` registry.
Matcher names, arguments, modifiers, and step bindings are preserved. Changes to
other code also require review, including added assertions and helper or control-flow
refactors. This catches changes such as removing the call to a helper that still
contains its original assertions.

Run the healthy scenarios separately to verify that updated selectors resolve to
the intended elements.
