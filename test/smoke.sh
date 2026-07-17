#!/usr/bin/env bash
set -euo pipefail

BASE_URL="http://localhost:3000"
PASS=0
FAIL=0
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# 1. Start server
node src/index.js &
SERVER_PID=$!

# 2. Wait for server to be ready
echo "Waiting for server..."
for i in $(seq 1 10); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/" || true)
  if [ "$CODE" = "200" ]; then
    echo "Server ready."
    break
  fi
  if [ "$i" = "10" ]; then
    echo "ERROR: Server never came up (last HTTP code: $CODE)"
    exit 1
  fi
  sleep 0.5
done

# 3. POST /api/groups
echo "Creating group..."
GROUP_RESP=$(curl -s -X POST "$BASE_URL/api/groups" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke","members":["Alice","Bob","Carol"]}')

echo "Group response: $GROUP_RESP"

GROUP_ID=$(echo "$GROUP_RESP" | jq -r '.id')
ALICE_ID=$(echo "$GROUP_RESP" | jq -r '.members[] | select(.name=="Alice") | .id')
BOB_ID=$(echo "$GROUP_RESP" | jq -r '.members[] | select(.name=="Bob") | .id')
CAROL_ID=$(echo "$GROUP_RESP" | jq -r '.members[] | select(.name=="Carol") | .id')

echo "Group ID: $GROUP_ID, Alice: $ALICE_ID, Bob: $BOB_ID, Carol: $CAROL_ID"

# 4. POST expense
echo "Adding expense..."
EXP_RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/api/groups/$GROUP_ID/expenses" \
  -H "Content-Type: application/json" \
  -d "{\"description\":\"Test\",\"amount\":\"22.00\",\"paid_by\":$ALICE_ID,\"split_between\":[$ALICE_ID,$BOB_ID,$CAROL_ID]}")

EXP_BODY=$(echo "$EXP_RESP" | sed -n '1p')
EXP_CODE=$(echo "$EXP_RESP" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')

echo "Expense response ($EXP_CODE): $EXP_BODY"

if [ "$EXP_CODE" != "201" ]; then
  echo "FAIL: Expected 201 for POST expense, got $EXP_CODE"
  exit 1
fi
echo "PASS: POST expense returned 201"

EXPENSE_ID=$(echo "$EXP_BODY" | jq -r '.id')

# 5. GET /api/groups/$GROUP_ID and check balances
echo "Checking balances..."
GROUP_DATA=$(curl -s "$BASE_URL/api/groups/$GROUP_ID")
echo "Group data: $GROUP_DATA"

ALICE_BAL=$(echo "$GROUP_DATA" | jq -r '.members[] | select(.name=="Alice") | .balance')
BOB_BAL=$(echo "$GROUP_DATA" | jq -r '.members[] | select(.name=="Bob") | .balance')
CAROL_BAL=$(echo "$GROUP_DATA" | jq -r '.members[] | select(.name=="Carol") | .balance')

echo "Alice: $ALICE_BAL, Bob: $BOB_BAL, Carol: $CAROL_BAL"

if echo "$ALICE_BAL" | grep -qF "14.66"; then
  echo "PASS: Alice balance is 14.66"
else
  echo "FAIL: Alice balance expected 14.66, got $ALICE_BAL"
  exit 1
fi

if echo "$BOB_BAL" | grep -qF -- "-7.33"; then
  echo "PASS: Bob balance is -7.33"
else
  echo "FAIL: Bob balance expected -7.33, got $BOB_BAL"
  exit 1
fi

if echo "$CAROL_BAL" | grep -qF -- "-7.33"; then
  echo "PASS: Carol balance is -7.33"
else
  echo "FAIL: Carol balance expected -7.33, got $CAROL_BAL"
  exit 1
fi

# 6. DELETE /api/expenses/$EXPENSE_ID
echo "Deleting expense..."
DEL_RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X DELETE "$BASE_URL/api/expenses/$EXPENSE_ID")
DEL_CODE=$(echo "$DEL_RESP" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')

if [ "$DEL_CODE" != "200" ]; then
  echo "FAIL: Expected 200 for DELETE expense, got $DEL_CODE"
  exit 1
fi
echo "PASS: DELETE expense returned 200"

# 7. GET group and verify all balances are 0.00
echo "Checking balances after delete..."
GROUP_DATA2=$(curl -s "$BASE_URL/api/groups/$GROUP_ID")
echo "Group data after delete: $GROUP_DATA2"

ALICE_BAL2=$(echo "$GROUP_DATA2" | jq -r '.members[] | select(.name=="Alice") | .balance')
BOB_BAL2=$(echo "$GROUP_DATA2" | jq -r '.members[] | select(.name=="Bob") | .balance')
CAROL_BAL2=$(echo "$GROUP_DATA2" | jq -r '.members[] | select(.name=="Carol") | .balance')

echo "Alice: $ALICE_BAL2, Bob: $BOB_BAL2, Carol: $CAROL_BAL2"

for NAME_BAL in "Alice:$ALICE_BAL2" "Bob:$BOB_BAL2" "Carol:$CAROL_BAL2"; do
  NAME=$(echo "$NAME_BAL" | cut -d: -f1)
  BAL=$(echo "$NAME_BAL" | cut -d: -f2)
  if echo "$BAL" | grep -qF "0.00"; then
    echo "PASS: $NAME balance is 0.00"
  else
    echo "FAIL: $NAME balance expected 0.00, got $BAL"
    exit 1
  fi
done

echo ""
echo "All smoke tests passed!"
exit 0
