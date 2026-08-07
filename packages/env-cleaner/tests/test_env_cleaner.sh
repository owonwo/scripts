#!/usr/bin/env bash
set -euo pipefail

BINARY="${1:-./env-cleaner}"
PASS=0
FAIL=0

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS  $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $desc"
    echo "        expected: $(printf '%q' "$expected")"
    echo "        actual:   $(printf '%q' "$actual")"
    FAIL=$((FAIL + 1))
  fi
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "=== env-cleaner tests ==="

# --- 1: basic comment stripping ---
cat > "$TMP/1.env" <<'EOF'
# this is a comment
DB_HOST=localhost
# another comment
DB_PORT=5432
EOF
out=$("$BINARY" "$TMP/1.env" | base64 -d)
assert_eq "strips full-line comments" $'DB_HOST=localhost\nDB_PORT=5432' "$out"

# --- 2: inline comments ---
cat > "$TMP/2.env" <<'EOF'
KEY=value # inline comment
EMPTY=
EOF
out=$("$BINARY" "$TMP/2.env" | base64 -d)
assert_eq "strips inline comments" $'KEY=value\nEMPTY=' "$out"

# --- 3: quoted hash preserved ---
cat > "$TMP/3.env" <<'EOF'
SECRET="abc#123"
PASSWORD='foo#bar'
BACKTICK=`baz#qux`
EOF
out=$("$BINARY" "$TMP/3.env" | base64 -d)
assert_eq "preserves # inside double quotes" 'SECRET="abc#123"' "$(echo "$out" | sed -n '1p')"
assert_eq "preserves # inside single quotes" "PASSWORD='foo#bar'" "$(echo "$out" | sed -n '2p')"
assert_eq "preserves # inside backtick" 'BACKTICK=`baz#qux`' "$(echo "$out" | sed -n '3p')"

# --- 4: whitespace trimming ---
cat > "$TMP/4.env" <<'EOF'
   KEY1=val1   

  KEY2=val2  
EOF
out=$("$BINARY" "$TMP/4.env" | base64 -d)
assert_eq "trims leading/trailing whitespace" $'KEY1=val1\nKEY2=val2' "$out"

# --- 5: indented comments ---
cat > "$TMP/5.env" <<'EOF'
  # indented comment
KEY=val
	# tabbed comment
EOF
out=$("$BINARY" "$TMP/5.env" | base64 -d)
assert_eq "strips indented comments" "KEY=val" "$out"

# --- 6: empty lines collapsed ---
cat > "$TMP/6.env" <<'EOF'
A=1


B=2


C=3
EOF
out=$("$BINARY" "$TMP/6.env" | base64 -d)
assert_eq "collapses blank lines" $'A=1\nB=2\nC=3' "$out"

# --- 7: comment-only file ---
cat > "$TMP/7.env" <<'EOF'
# just comments
# still comments
  # also comments
EOF
out=$("$BINARY" "$TMP/7.env" | base64 -d)
assert_eq "comment-only file produces empty output" "" "$out"

# --- 8: empty file ---
: > "$TMP/8.env"
out=$("$BINARY" "$TMP/8.env" | base64 -d)
assert_eq "empty file produces empty output" "" "$out"

# --- 9: real-world .env ---
cat > "$TMP/9.env" <<'EOF'
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=myapp # production db

# Secrets
SECRET_KEY="s3cr3t#hash"
API_KEY='sk-1234'

# empty value
CACHE_SIZE=
EOF
out=$("$BINARY" "$TMP/9.env" | base64 -d)
expected=$'DB_HOST=localhost\nDB_PORT=5432\nDB_NAME=myapp\nSECRET_KEY="s3cr3t#hash"\nAPI_KEY=\'sk-1234\'\nCACHE_SIZE='
assert_eq "real-world .env" "$expected" "$out"

# --- 10: no such file ---
set +e
"$BINARY" "$TMP/nope.env" >/dev/null 2>&1
rc=$?
set -e
assert_eq "non-existent file exits non-zero" "1" "$rc"

# --- summary ---
echo "---"
echo "result: $PASS passed, $FAIL failed"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
