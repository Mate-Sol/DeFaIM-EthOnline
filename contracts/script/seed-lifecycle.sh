#!/usr/bin/env bash
#
# seed-lifecycle.sh — drive facilities through the lifecycle on Arc.
#
# Arc's USDC is the chain's native gas token behind an ERC-20 facade. Its
# transfer path is implemented by the node, not by ordinary EVM bytecode, so
# `forge script` cannot execute it: forge runs the script body in a local EVM
# to collect transactions, and USDC transferFrom aborts there with a
# StackUnderflow before anything is broadcast. `--skip-simulation` does not
# help, because the local run is how forge learns what to send.
#
# So every state change here goes out as a real transaction via `cast send`.
#
# Usage:
#   export RPC_URL=https://rpc.testnet.arc.io
#   export DEPLOYER_PRIVATE_KEY=0x...
#   export FACTORY=0x...
#   ./script/seed-lifecycle.sh phase1
#   ...wait out the funding window...
#   ./script/seed-lifecycle.sh phase2

set -euo pipefail

RPC_URL="${RPC_URL:-https://rpc.testnet.arc.io}"
FACTORY="${FACTORY:?set FACTORY}"
PK="${DEPLOYER_PRIVATE_KEY:?set DEPLOYER_PRIVATE_KEY}"
USDC=0x3600000000000000000000000000000000000000
ME=$(cast wallet address --private-key "$PK")

export ETH_RPC_URL="$RPC_URL"
SEND="cast send --private-key $PK --rpc-url $RPC_URL --json"
STATE_FILE="${STATE_FILE:-./script/.seed-state}"

# The factory snaps a pool's funding maturity up to the next UTC midnight, so
# the effective funding window is never shorter than the time remaining in the
# current UTC day — a short FUNDING_SECS does not shorten it.

# USDC, 6 decimals
SOFT_CAP=200000       # 0.20
HARD_CAP=20000000     # 20.00
DEPOSIT=400000        # 0.40
DRAW=150000           # 0.15

FUNDING_SHORT="${FUNDING_SECS:-150}"
FUNDING_LONG=1209600  # 14 days

say() { printf '\n\033[1m%s\033[0m\n' "$*" >&2; }
ok()  { printf '  ✓ %s\n' "$*" >&2; }   # stderr: stdout carries return values

# createPool(tuple(...)) — field order must match PoolFactory.CreatePoolParams
CREATE_SIG='createPool((address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,address,address,address))'

create_pool() {  # $1 label  $2 psp  $3 fundingSecs  $4 aprWad
  local label="$1" psp="$2" secs="$3" apr="$4"
  $SEND "$FACTORY" "$CREATE_SIG" \
    "($psp,$secs,$SOFT_CAP,$HARD_CAP,30,10000000000000,1000000000000000,2000000000000000,2,0,$apr,$ME,$ME,$ME)" \
    > /dev/null
  local n idx pool
  n=$(cast call "$FACTORY" 'poolCount()(uint256)')
  idx=$((n - 1))
  pool=$(cast call "$FACTORY" 'pools(uint256)(address)' "$idx")
  ok "$label  $pool"
  echo "$pool"
}

psp_addr() { cast keccak "defa.psp.$1" | sed 's/^0x.\{24\}/0x/'; }

phase1() {
  say "Phase 1 — approve borrowers, create facilities, commit lender capital"

  for name in meridian aurum mercury atlas; do
    p=$(psp_addr "$name")
    $SEND "$FACTORY" 'approvePsp(address)' "$p" > /dev/null
    ok "approvePsp  $name  $p"
  done

  FRESH=$(create_pool   "Meridian FX Corridor  (Funding)" "$(psp_addr meridian)" "$FUNDING_LONG"  140000000000000000)
  FUNDED=$(create_pool  "Aurum Cross-Border    (Funded) " "$(psp_addr aurum)"    "$FUNDING_LONG"   60000000000000000)
  DRAWN=$(create_pool   "Mercury Settlements   (Drawn)  " "$(psp_addr mercury)"  "$FUNDING_SHORT" 120000000000000000)
  SETTLED=$(create_pool "Atlas Trade Finance   (Settled)" "$(psp_addr atlas)"    "$FUNDING_SHORT"  90000000000000000)

  say "Committing lender capital"
  for pool in "$FUNDED" "$DRAWN" "$SETTLED"; do
    $SEND "$USDC" 'approve(address,uint256)' "$pool" "$DEPOSIT" > /dev/null
    $SEND "$pool" 'deposit(uint256)' "$DEPOSIT" > /dev/null
    ok "deposited 0.40 USDC into $pool"
  done

  cat > "$STATE_FILE" <<EOF
FRESH=$FRESH
FUNDED=$FUNDED
DRAWN=$DRAWN
SETTLED=$SETTLED
EOF
  say "Phase 1 complete — state written to $STATE_FILE"
  echo "Wait ${FUNDING_SHORT}s for the funding window to close, then: $0 phase2"
}

phase2() {
  # shellcheck source=/dev/null
  source "$STATE_FILE"
  say "Phase 2 — lock, draw, repay, claim"

  $SEND "$DRAWN" 'finalizeFunding()' > /dev/null;            ok "Mercury locked"
  $SEND "$DRAWN" 'addReceiver(address)' "$ME" > /dev/null
  REF_A=$(cast keccak "mercury-drawdown-1")
  $SEND "$DRAWN" 'executeDrawdown(bytes32,address,uint256,uint256)' "$REF_A" "$ME" "$DRAW" 5 > /dev/null
  ok "Mercury drawn 0.15 USDC — left outstanding"

  $SEND "$SETTLED" 'finalizeFunding()' > /dev/null;          ok "Atlas locked"
  $SEND "$SETTLED" 'addReceiver(address)' "$ME" > /dev/null
  REF_B=$(cast keccak "atlas-drawdown-1")
  $SEND "$SETTLED" 'executeDrawdown(bytes32,address,uint256,uint256)' "$REF_B" "$ME" "$DRAW" 5 > /dev/null
  ok "Atlas drawn 0.15 USDC"

  OWED=$(cast call "$SETTLED" 'getRepaymentOwed(bytes32)(uint256,uint256,uint256)' "$REF_B" | tail -1 | awk '{print $1}')
  $SEND "$USDC" 'approve(address,uint256)' "$SETTLED" "$OWED" > /dev/null
  $SEND "$SETTLED" 'repay(bytes32)' "$REF_B" > /dev/null
  ok "Atlas repaid $OWED base units"

  $SEND "$SETTLED" 'claimYield()' > /dev/null;               ok "Atlas lender claimed yield"
  $SEND "$SETTLED" 'claimPrincipal()' > /dev/null;           ok "Atlas lender claimed principal"

  say "Phase 2 complete"
}

case "${1:-}" in
  phase1) phase1 ;;
  phase2) phase2 ;;
  *) echo "usage: $0 {phase1|phase2}" >&2; exit 1 ;;
esac
