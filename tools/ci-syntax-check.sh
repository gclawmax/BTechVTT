#!/usr/bin/env bash
# CI check 1: syntax-gate every JS file in js/ (node --check). Parse errors only;
# semantic regressions are the hermetic tests' job below.
fail=0; count=0
for f in $(find js -name '*.js' -type f); do
  count=$((count+1))
  if ! node --check "$f" >/dev/null 2>&1; then echo "SYNTAX FAIL: $f"; fail=1; fi
done
echo "syntax-checked $count files"
exit $fail
