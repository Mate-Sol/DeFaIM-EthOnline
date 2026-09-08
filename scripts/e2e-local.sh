#!/usr/bin/env bash
#
# e2e-local.sh — drive a facility through its entire lifecycle on a local chain.
#
# Why local: two of the pool's behaviours are time-gated. Funding maturity snaps
# up to the next UTC midnight, and the pool must then be locked inside
# fundingExecBufferDays or it closes Unsuccessful. On a real network that means
# waiting; on Anvil we can move the clock, so the whole lifecycle runs in about
# a minute and every state is reachable on demand.
#
# It also settles in MockStablecoin rather than USDC — the deploy script picks
# the mock automatically off-chain-id, since Arc's native USDC only exists on
# Arc. The contract logic exercised is identical.
#
# Covers: create -> deposit -> lock -> drawdown -> repay -> claim yield and
#         principal, asserting on-chain state at each step.
#
# Usage:  ./scripts/e2e-local.sh
# Leaves anvil running unless KEEP_ANVIL=0.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC=http://127.0.0.1:8545
# Anvil's first deterministic account.
PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ME=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
KEEP_ANVIL="${KEEP_ANVIL:-1}"

export ETH_RPC_URL="$RPC"
SEND="cast send --private-key $PK --rpc-url $RPC"

# USDC-scale amounts, 6 decimals
SOFT_CAP=200000000      # 200
HARD_CAP=10000000000    # 10,000
DEPOSIT=1000000000      # 1,000
DRAW=400000000          # 400

step()  { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail()  { printf '  \033[31m✗ %s\033[0m\n' "$*"; exit 1; }
u6()    { python3 -c "print(f'{int($1)/1e6:,.2f}')"; }

expect_status() {  # $1 pool  $2 expected  $3 label
  local got; got=$(cast call "$1" 'status()(uint8)' | awk '{print $1}')
  [ "$got" = "$2" ] || fail "$3: expected status $2, got $got"
  ok "$3"
}

# ── 0. chain ────────────────────────────────────────────────────────────────
step "Starting a local chain"
if ! curl -s -m 2 -X POST "$RPC" -H 'Content-Type: application/json' \
     --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1; then
  anvil --silent --chain-id 31337 >/tmp/anvil-e2e.log 2>&1 &
  until curl -s -m 2 -X POST "$RPC" -H 'Content-Type: application/json' \
        --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1; do sleep 1; done
fi
ok "anvil on $RPC (chain 31337)"

# ── 1. contracts ────────────────────────────────────────────────────────────
step "Deploying the contract set"
cd "$ROOT/contracts"
OUT=$(forge script script/Deploy.s.sol:DeployScript --rpc-url "$RPC" --broadcast \
        --private-key "$PK" 2>&1)
FACTORY=$(echo "$OUT"   | grep 'PAYFI_FACTORY_ADDRESS'    | awk '{print $NF}')
TREASURY=$(echo "$OUT"  | grep 'PAYFI_TREASURY_ADDRESS'   | awk '{print $NF}')
USDC=$(echo "$OUT"      | grep 'PAYFI_STABLECOIN_ADDRESS' | awk '{print $NF}')
[ -n "$FACTORY" ] || { echo "$OUT" | tail -20; fail "deploy failed"; }
ok "factory   $FACTORY"
ok "treasury  $TREASURY"
ok "settles in $USDC (MockStablecoin — no USDC precompile off Arc)"

# ── 2. facility ─────────────────────────────────────────────────────────────
step "Creating a facility"
PSP=$(cast keccak "e2e.psp" | sed 's/^0x.\{24\}/0x/')
$SEND "$FACTORY" 'approvePsp(address)' "$PSP" >/dev/null
SIG='createPool((address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,address,address,address))'
$SEND "$FACTORY" "$SIG" \
  "($PSP,3600,$SOFT_CAP,$HARD_CAP,30,10000000000000,1000000000000000,2000000000000000,2,0,120000000000000000,$ME,$ME,$ME)" >/dev/null
POOL=$(cast call "$FACTORY" 'pools(uint256)(address)' 0)
ok "pool $POOL  (12% APR, 30d tenure)"
expect_status "$POOL" 0 "status: Funding"

# ── 3. lender deposits ──────────────────────────────────────────────────────
step "Lender commits capital"
$SEND "$USDC" 'mint(address,uint256)' "$ME" 100000000000 >/dev/null
$SEND "$USDC" 'approve(address,uint256)' "$POOL" "$DEPOSIT" >/dev/null
$SEND "$POOL" 'deposit(uint256)' "$DEPOSIT" >/dev/null
TA=$(cast call "$POOL" 'totalAssets()(uint256)' | awk '{print $1}')
[ "$TA" = "$DEPOSIT" ] || fail "totalAssets $TA != $DEPOSIT"
ok "deposited $(u6 $DEPOSIT) — totalAssets $(u6 $TA)"
ok "ERC-4626 surface: balanceOf $(u6 "$(cast call "$POOL" 'balanceOf(address)(uint256)' $ME | awk '{print $1}')")"

# ── 4. lock ─────────────────────────────────────────────────────────────────
step "Closing the funding window"
FM=$(cast call "$POOL" 'fMaturityTs()(uint256)' | awk '{print $1}')
cast rpc anvil_setNextBlockTimestamp $((FM + 60)) >/dev/null
cast rpc anvil_mine >/dev/null
ok "clock moved to funding maturity (+60s)"
$SEND "$POOL" 'finalizeFunding()' >/dev/null
expect_status "$POOL" 1 "status: Active — capital deployed"
ok "maxDeposit now $(u6 "$(cast call "$POOL" 'maxDeposit(address)(uint256)' $ME | awk '{print $1}')") (closed to new deposits)"

# ── 5. drawdown ─────────────────────────────────────────────────────────────
step "Borrower draws against the facility"
$SEND "$POOL" 'addReceiver(address)' "$ME" >/dev/null
REF=$(cast keccak "e2e-drawdown-1")
$SEND "$POOL" 'executeDrawdown(bytes32,address,uint256,uint256)' "$REF" "$ME" "$DRAW" 5 >/dev/null
OUTS=$(cast call "$POOL" 'outstanding()(uint256)' | awk '{print $1}')
[ "$OUTS" = "$DRAW" ] || fail "outstanding $OUTS != $DRAW"
ok "drew $(u6 $DRAW) — outstanding $(u6 $OUTS)"

# ── 6. repay ────────────────────────────────────────────────────────────────
step "Borrower repays on settlement"
cast rpc anvil_setNextBlockTimestamp $((FM + 60 + 5 * 86400)) >/dev/null
cast rpc anvil_mine >/dev/null
ok "clock moved 5 days (settlement window)"
OWED=$(cast call "$POOL" 'getRepaymentOwed(bytes32)(uint256,uint256,uint256)' "$REF" | tail -1 | awk '{print $1}')
$SEND "$USDC" 'approve(address,uint256)' "$POOL" "$OWED" >/dev/null
$SEND "$POOL" 'repay(bytes32)' "$REF" >/dev/null
OUTS=$(cast call "$POOL" 'outstanding()(uint256)' | awk '{print $1}')
[ "$OUTS" = "0" ] || fail "outstanding $OUTS after repay"
ok "repaid $(u6 $OWED) — principal $(u6 $DRAW) plus $(u6 $((OWED - DRAW))) in fees"

# ── 7. claim ────────────────────────────────────────────────────────────────
step "Lender claims"
BEFORE=$(cast call "$USDC" 'balanceOf(address)(uint256)' "$ME" | awk '{print $1}')
$SEND "$POOL" 'claimYield()' >/dev/null
MID=$(cast call "$USDC" 'balanceOf(address)(uint256)' "$ME" | awk '{print $1}')
$SEND "$POOL" 'claimPrincipal()' >/dev/null
AFTER=$(cast call "$USDC" 'balanceOf(address)(uint256)' "$ME" | awk '{print $1}')
ok "yield claimed     $(u6 $((MID - BEFORE)))"
[ "$((MID - BEFORE))" -gt 0 ] || fail "no yield reached the lender"

# Principal is not collectible the moment a drawdown is repaid — repaid
# capital returns to the pool's available liquidity and is released to
# lenders when the facility matures. So this is expected to be zero here.
ok "principal claimed $(u6 $((AFTER - MID))) (facility still running)"

# ── 8. maturity ─────────────────────────────────────────────────────────────
step "Facility matures"
FIN=$(cast call "$POOL" 'poolFinalityTs()(uint256)' | awk '{print $1}')
cast rpc anvil_setNextBlockTimestamp $((FIN + 60)) >/dev/null
cast rpc anvil_mine >/dev/null
ok "clock moved past finality (30d tenure)"
$SEND "$POOL" 'claimYield()' >/dev/null || true
$SEND "$POOL" 'claimPrincipal()' >/dev/null
FINAL=$(cast call "$USDC" 'balanceOf(address)(uint256)' "$ME" | awk '{print $1}')
ok "principal returned $(u6 $((FINAL - AFTER)))"
[ "$((FINAL - BEFORE))" -gt "$DEPOSIT" ] || fail "lender did not recover deposit plus yield"
ok "lender out $(u6 $DEPOSIT), back $(u6 $((FINAL - BEFORE)))"

printf '\n\033[1;32m✓ Full lifecycle passed on the local chain\033[0m\n'
cat <<EOF

  Point the API at this chain to exercise the stack end to end:

    EVM_CHAIN_ID=31337
    EVM_RPC_URL=$RPC
    PAYFI_FACTORY_ADDRESS=$FACTORY
    PAYFI_TREASURY_ADDRESS=$TREASURY
    PAYFI_STABLECOIN_ADDRESS=$USDC
    AGENT_PRIVATE_KEY=$PK

EOF
[ "$KEEP_ANVIL" = "1" ] || pkill -f "anvil --silent" || true
