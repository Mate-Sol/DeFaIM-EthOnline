#!/usr/bin/env bash
#
# grant-admin.sh — give an address the two roles the on-chain admin flow needs.
#
# The admin step in the portal is two signed transactions:
#   factory.approvePsp(...)  requires MULTISIG_ROLE
#   factory.createPool(...)  requires DEPLOYER_ROLE
# Granting only one leaves the operator stuck halfway, so this grants both, on
# both the production and the fast-clock factory.
#
# Reads RPC_URL and DEPLOYER_PRIVATE_KEY from contracts/.env.
#
# Usage:  ./script/grant-admin.sh 0xAddress

set -euo pipefail

WHO="${1:?usage: $0 <address>}"

cd "$(dirname "${BASH_SOURCE[0]}")/.."
set -a; . ./.env; set +a
export ETH_RPC_URL="$RPC_URL"

DEPLOYER_ROLE=0xfc425f2263d0df187444b70e47283d622c70181c5baebb1306a01edba1ce184c
MULTISIG_ROLE=0xa5a0b70b385ff7611cd3840916bd08b10829e5bf9e6637cf79dd9a427fc0e2ab

FACTORIES=(
  "production:0xB5AB6FD1672642cfafcf6A44b2eEAB712576f466"
  "fast-clock:0xE912Fd28FBa9E39b18d8d19D38c8bd35b565e751"
)

for entry in "${FACTORIES[@]}"; do
  label="${entry%%:*}"; factory="${entry##*:}"
  printf '\n\033[1m%s\033[0m  %s\n' "$label" "$factory"

  for role in "DEPLOYER_ROLE:$DEPLOYER_ROLE" "MULTISIG_ROLE:$MULTISIG_ROLE"; do
    name="${role%%:*}"; hash="${role##*:}"

    if [ "$(cast call "$factory" 'hasRole(bytes32,address)(bool)' "$hash" "$WHO")" = "true" ]; then
      printf '  \033[32m✓\033[0m %-14s already granted\n' "$name"
      continue
    fi

    cast send "$factory" 'grantRole(bytes32,address)' "$hash" "$WHO" \
      --rpc-url "$RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" \
      --confirmations 1 > /dev/null
    sleep 3

    if [ "$(cast call "$factory" 'hasRole(bytes32,address)(bool)' "$hash" "$WHO")" = "true" ]; then
      printf '  \033[32m✓\033[0m %-14s granted\n' "$name"
    else
      printf '  \033[31m✗\033[0m %-14s FAILED\n' "$name"
    fi
    sleep 2
  done
done

printf '\n\033[1m%s can now run the on-chain admin flow on both factories.\033[0m\n' "$WHO"
