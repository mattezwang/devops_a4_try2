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

# ============================================================
# Step-2 assertions (server still running, group still exists)
# At this point: all three step-1 expenses were deleted → balances all 0.00
# ============================================================

echo ""
echo "=== Step-2 assertions ==="

# S2-1: Backward-compat — equal-split without split_type field still works
echo "S2-1: equal-split, no split_type field (backward compat)..."
EQ_RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/api/groups/$GROUP_ID/expenses" \
  -H "Content-Type: application/json" \
  -d "{\"description\":\"Groceries\",\"amount\":\"22.00\",\"paid_by\":$ALICE_ID,\"split_between\":[$ALICE_ID,$BOB_ID,$CAROL_ID]}")
EQ_BODY=$(echo "$EQ_RESP" | sed -n '1p')
EQ_CODE=$(echo "$EQ_RESP" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')
[ "$EQ_CODE" = "201" ] && echo "PASS: S2-1 returns 201" || { echo "FAIL: S2-1 expected 201 got $EQ_CODE"; exit 1; }
EQ_SPLIT_TYPE=$(echo "$EQ_BODY" | jq -r '.split_type')
[ "$EQ_SPLIT_TYPE" = "equal" ] && echo "PASS: S2-1 split_type is equal" || { echo "FAIL: S2-1 split_type expected equal got $EQ_SPLIT_TYPE"; exit 1; }
EQ_EXPENSE_ID=$(echo "$EQ_BODY" | jq -r '.id')

# S2-2: Exact split expense — shares must match input exactly
echo "S2-2: exact split (Alice \$10.00, Bob \$20.00 of \$30.00)..."
EXACT_RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/api/groups/$GROUP_ID/expenses" \
  -H "Content-Type: application/json" \
  -d "{\"description\":\"Dinner\",\"amount\":\"30.00\",\"paid_by\":$ALICE_ID,\"split_type\":\"exact\",\"splits\":[{\"member_id\":$ALICE_ID,\"amount\":\"10.00\"},{\"member_id\":$BOB_ID,\"amount\":\"20.00\"}]}")
EXACT_BODY=$(echo "$EXACT_RESP" | sed -n '1p')
EXACT_CODE=$(echo "$EXACT_RESP" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')
[ "$EXACT_CODE" = "201" ] && echo "PASS: S2-2 returns 201" || { echo "FAIL: S2-2 expected 201 got $EXACT_CODE; body: $EXACT_BODY"; exit 1; }
ALICE_EXACT=$(echo "$EXACT_BODY" | jq -r ".splits[] | select(.member_id==$ALICE_ID) | .share_amount")
BOB_EXACT=$(echo "$EXACT_BODY" | jq -r ".splits[] | select(.member_id==$BOB_ID) | .share_amount")
[ "$ALICE_EXACT" = "10.00" ] && echo "PASS: S2-2 Alice share is 10.00" || { echo "FAIL: S2-2 Alice expected 10.00 got $ALICE_EXACT"; exit 1; }
[ "$BOB_EXACT" = "20.00" ]   && echo "PASS: S2-2 Bob share is 20.00"   || { echo "FAIL: S2-2 Bob expected 20.00 got $BOB_EXACT"; exit 1; }
EXACT_EXPENSE_ID=$(echo "$EXACT_BODY" | jq -r '.id')

# S2-3: Percentage split — 33.33/33.33/33.34 rounding case
echo "S2-3: percentage split 33.33/33.33/33.34 on \$10.00..."
PCT_RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/api/groups/$GROUP_ID/expenses" \
  -H "Content-Type: application/json" \
  -d "{\"description\":\"Rent\",\"amount\":\"10.00\",\"paid_by\":$ALICE_ID,\"split_type\":\"percentage\",\"splits\":[{\"member_id\":$ALICE_ID,\"percentage\":33.33},{\"member_id\":$BOB_ID,\"percentage\":33.33},{\"member_id\":$CAROL_ID,\"percentage\":33.34}]}")
PCT_BODY=$(echo "$PCT_RESP" | sed -n '1p')
PCT_CODE=$(echo "$PCT_RESP" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')
[ "$PCT_CODE" = "201" ] && echo "PASS: S2-3 returns 201" || { echo "FAIL: S2-3 expected 201 got $PCT_CODE; body: $PCT_BODY"; exit 1; }
ALICE_PCT=$(echo "$PCT_BODY" | jq -r ".splits[] | select(.member_id==$ALICE_ID) | .share_amount")
BOB_PCT=$(echo "$PCT_BODY" | jq -r ".splits[] | select(.member_id==$BOB_ID) | .share_amount")
CAROL_PCT=$(echo "$PCT_BODY" | jq -r ".splits[] | select(.member_id==$CAROL_ID) | .share_amount")
[ "$ALICE_PCT" = "3.33" ]  && echo "PASS: S2-3 Alice share is 3.33"  || { echo "FAIL: S2-3 Alice expected 3.33 got $ALICE_PCT"; exit 1; }
[ "$BOB_PCT" = "3.33" ]    && echo "PASS: S2-3 Bob share is 3.33"    || { echo "FAIL: S2-3 Bob expected 3.33 got $BOB_PCT"; exit 1; }
[ "$CAROL_PCT" = "3.34" ]  && echo "PASS: S2-3 Carol share is 3.34"  || { echo "FAIL: S2-3 Carol expected 3.34 got $CAROL_PCT"; exit 1; }
PCT_EXPENSE_ID=$(echo "$PCT_BODY" | jq -r '.id')

# Clean up: delete exact and pct expenses; keep EQ_EXPENSE_ID ($22.00 grocery) for balance tests
curl -s -X DELETE "$BASE_URL/api/expenses/$EXACT_EXPENSE_ID" > /dev/null
curl -s -X DELETE "$BASE_URL/api/expenses/$PCT_EXPENSE_ID" > /dev/null

# S2-4: Suggested settlements with 3 members after $22.00 expense paid by Alice
echo "S2-4: suggested settlements for 3-member group (\$22.00 grocery by Alice)..."
SUGG=$(curl -s "$BASE_URL/api/groups/$GROUP_ID/settlements/suggested")
SUGG_COUNT=$(echo "$SUGG" | jq '.suggested_settlements | length')
[ "$SUGG_COUNT" = "2" ] && echo "PASS: S2-4 suggested_settlements count is 2" || { echo "FAIL: S2-4 expected 2 got $SUGG_COUNT; body: $SUGG"; exit 1; }
BOB_PAYS=$(echo "$SUGG" | jq -r ".suggested_settlements[] | select(.from.id==$BOB_ID and .to.id==$ALICE_ID) | .amount")
CAROL_PAYS=$(echo "$SUGG" | jq -r ".suggested_settlements[] | select(.from.id==$CAROL_ID and .to.id==$ALICE_ID) | .amount")
[ "$BOB_PAYS" = "7.33" ]   && echo "PASS: S2-4 Bob pays Alice 7.33"   || { echo "FAIL: S2-4 Bob->Alice expected 7.33 got $BOB_PAYS"; exit 1; }
[ "$CAROL_PAYS" = "7.33" ] && echo "PASS: S2-4 Carol pays Alice 7.33" || { echo "FAIL: S2-4 Carol->Alice expected 7.33 got $CAROL_PAYS"; exit 1; }
TOTAL_SUGG=$(echo "$SUGG" | jq '[.suggested_settlements[].amount | tonumber] | add')
echo "$TOTAL_SUGG" | grep -qF "14.66" && echo "PASS: S2-4 suggested amounts sum to 14.66" || echo "WARN: S2-4 sum was $TOTAL_SUGG (floating point — not fatal)"

# S2-5: Record settlement Bob→Alice $7.33 and assert balances update
echo "S2-5: POST settlement Bob->Alice \$7.33..."
SET_RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/api/groups/$GROUP_ID/settlements" \
  -H "Content-Type: application/json" \
  -d "{\"from_member_id\":$BOB_ID,\"to_member_id\":$ALICE_ID,\"amount\":\"7.33\"}")
SET_BODY=$(echo "$SET_RESP" | sed -n '1p')
SET_CODE=$(echo "$SET_RESP" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')
[ "$SET_CODE" = "201" ] && echo "PASS: S2-5 POST settlement returns 201" || { echo "FAIL: S2-5 expected 201 got $SET_CODE; body: $SET_BODY"; exit 1; }
SETTLEMENT_ID=$(echo "$SET_BODY" | jq -r '.id')

AFTER_SETTLE=$(curl -s "$BASE_URL/api/groups/$GROUP_ID")
ALICE_SET=$(echo "$AFTER_SETTLE" | jq -r '.members[] | select(.name=="Alice") | .balance')
BOB_SET=$(echo "$AFTER_SETTLE" | jq -r '.members[] | select(.name=="Bob") | .balance')
CAROL_SET=$(echo "$AFTER_SETTLE" | jq -r '.members[] | select(.name=="Carol") | .balance')
echo "$ALICE_SET" | grep -qF "7.33"    && echo "PASS: S2-5 Alice balance is 7.33 after settlement"   || { echo "FAIL: S2-5 Alice expected 7.33 got $ALICE_SET"; exit 1; }
echo "$BOB_SET"   | grep -qF "0.00"   && echo "PASS: S2-5 Bob balance is 0.00 after settlement"     || { echo "FAIL: S2-5 Bob expected 0.00 got $BOB_SET"; exit 1; }
echo "$CAROL_SET" | grep -qF -- "-7.33" && echo "PASS: S2-5 Carol balance is -7.33 after settlement" || { echo "FAIL: S2-5 Carol expected -7.33 got $CAROL_SET"; exit 1; }

# Verify feed contains settlement item
FEED_LEN=$(echo "$AFTER_SETTLE" | jq '.feed | length')
[ "$FEED_LEN" -ge "2" ] && echo "PASS: S2-5 feed has at least 2 items (expense + settlement)" || { echo "FAIL: S2-5 feed length expected >=2 got $FEED_LEN"; exit 1; }
SETTLE_IN_FEED=$(echo "$AFTER_SETTLE" | jq ".feed[] | select(.type==\"settlement\" and .id==$SETTLEMENT_ID) | .id")
[ "$SETTLE_IN_FEED" = "$SETTLEMENT_ID" ] && echo "PASS: S2-5 settlement appears in feed" || { echo "FAIL: S2-5 settlement not found in feed"; exit 1; }

# S2-6: Delete settlement and assert balances revert to pre-settlement state
echo "S2-6: DELETE settlement and assert balances revert..."
DEL_SET_RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X DELETE "$BASE_URL/api/settlements/$SETTLEMENT_ID")
DEL_SET_CODE=$(echo "$DEL_SET_RESP" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')
[ "$DEL_SET_CODE" = "200" ] && echo "PASS: S2-6 DELETE settlement returns 200" || { echo "FAIL: S2-6 expected 200 got $DEL_SET_CODE"; exit 1; }

AFTER_DEL_SET=$(curl -s "$BASE_URL/api/groups/$GROUP_ID")
ALICE_REV=$(echo "$AFTER_DEL_SET" | jq -r '.members[] | select(.name=="Alice") | .balance')
BOB_REV=$(echo "$AFTER_DEL_SET" | jq -r '.members[] | select(.name=="Bob") | .balance')
CAROL_REV=$(echo "$AFTER_DEL_SET" | jq -r '.members[] | select(.name=="Carol") | .balance')
echo "$ALICE_REV" | grep -qF "14.66"    && echo "PASS: S2-6 Alice balance reverted to 14.66"   || { echo "FAIL: S2-6 Alice expected 14.66 got $ALICE_REV"; exit 1; }
echo "$BOB_REV"   | grep -qF -- "-7.33" && echo "PASS: S2-6 Bob balance reverted to -7.33"     || { echo "FAIL: S2-6 Bob expected -7.33 got $BOB_REV"; exit 1; }
echo "$CAROL_REV" | grep -qF -- "-7.33" && echo "PASS: S2-6 Carol balance reverted to -7.33"   || { echo "FAIL: S2-6 Carol expected -7.33 got $CAROL_REV"; exit 1; }

echo ""
echo "All smoke tests passed (step 1 + step 2)!"
exit 0
