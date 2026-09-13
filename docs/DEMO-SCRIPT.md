# DeFa — demo video script

**ETHOnline 2026 · Arc · Target length 2:45 (hard bound 2–4 min)**

The flow is long. The video is not. Judges will not run the lifecycle, so the
video's job is to make them believe it is real — not to walk them through it.
Show the three moments that could not be faked, and say why each matters.

Do not narrate the UI. Say what is at stake; let the screen show the mechanic.

---

## 0:00 – 0:25 · The problem

> A payment company pays a merchant out today and gets paid by the corridor in
> three to seven days. Someone has to fund that gap on every single
> transaction. It is the biggest limit on how much volume they can process —
> not demand, working capital.
>
> Today that is bank credit. Weeks to underwrite, priced on a balance sheet
> rather than the receivables it is secured against. Double your volume and you
> wait a quarter for a limit you could already collateralise.

**On screen:** title card, then the timeline — merchant paid day 0, corridor
settles day 3–7, the gap shaded.

---

## 0:25 – 0:45 · What it is

> DeFa is that facility with the credit process enforced by the contract. A
> credit committee still underwrites it. The terms they approve *become* the
> pool's parameters. After that the borrower draws and repays on their own,
> inside a line that cannot be exceeded, at a rate the contract computes per
> second.
>
> It settles in USDC on Arc, where USDC is the native gas token — so the
> facility is funded, drawn and repaid in the same unit the borrower already
> works in. No bridge, no second token.

**On screen:** the system diagram from `docs/ARCHITECTURE.md`.

---

## 0:45 – 1:45 · The three moments

Cut hard between these. No page loads, no form filling, no menu navigation.

### 1 · Underwriting is real (≈20s)

CRO review screen → approve with terms → facility moves to `AWAITING_POOL_INIT`.

> A risk officer sets the line, the tenor and the rates. This is not a
> parameter in a config file — it is the approval that mints the facility.

### 2 · The facility exists on chain (≈20s)

Initialize → MetaMask signs → pool address on **arcscan**, borrower address
visible.

> The pool is its own contract. The borrower wallet is stamped in at creation
> and cannot be changed afterwards — not by us, not by an admin.

### 3 · Draw and repay (≈25s)

Drawdown → USDC lands in the borrower's wallet → repay → **outstanding goes to
zero**, finance charge shown.

> The draw is gated on-chain: the receiver must be pre-authorised and the
> amount must fit the line. The repayment charge is computed by the contract.
> Nobody invoices anything.

**Say the clock out loud**, once:

> This is running on a build where a contract day passes in a minute, so a
> 30-day facility completes while you watch. Same contracts, same logic.

Without that line the timings look wrong and it reads as faked.

---

## 1:45 – 2:15 · The Graph

Terminal: `node agent/src/index.js --demo-clock`

> A credit book is a portfolio question, not a per-loan one. Which borrower is
> concentrated, which draw is past grace and accruing penalties, which facility
> reaches maturity with money still out.
>
> Those questions cost one RPC call per pool per field — enough to trip the
> node's rate limiter, which is exactly what happened to us. So the read layer
> is a Subgraph, and this agent reasons over it.

**On screen:** the CRITICAL finding, then the GraphQL query returning the
repayment from moment 3 — same transaction hash.

> The agent has no RPC client and no database. Switch The Graph off and it has
> nothing to think with.

The schema point, said once:

> The schema is ERC-4626, so a credit facility reads like a vault to anything
> that already understands vaults.

---

## 2:15 – 2:35 · Privy

Terminal, two commands side by side.

> One server key can move lender capital — it signs drawdowns. That was a
> private key in an environment variable.
>
> It is now a Privy wallet with a policy. A zero-value contract call signs…

*(show it succeed)*

> …and anything that moves value is refused, in the enclave, before a signature
> exists.

*(show `RPC request denied due to policy violation`)*

> On Arc, USDC is the native token — so that policy is the difference between
> a stolen key calling a contract and a stolen key taking the money.

This is the strongest twenty seconds in the video. A live refusal is worth more
than any architecture slide.

---

## 2:35 – 2:45 · Close

> Contracts, subgraph, risk agent and both portals are live on Arc testnet
> today. Deployable to Arc mainnet at launch.

**On screen:** repo URL, lender portal URL, Subgraph endpoint.

---

## Shot list — record these before writing narration

| # | Shot | Source |
|---|---|---|
| 1 | Gap timeline | slide |
| 2 | System diagram | `docs/ARCHITECTURE.md` |
| 3 | CRO approval with terms | admin portal |
| 4 | Pool on arcscan, borrower visible | testnet.arcscan.app |
| 5 | Drawdown arriving in wallet | MetaMask / portal |
| 6 | Repay → outstanding 0 | borrower portal |
| 7 | Risk agent CRITICAL finding | terminal |
| 8 | GraphQL returning that repayment | Studio playground |
| 9 | Privy: call signs | terminal |
| 10 | Privy: value transfer refused | terminal |

## Notes

- **Do not leave a drawdown open between takes.** Penalty accrues per contract
  day, which is a real minute here; an overnight draw shows a principal of 10
  and a debt of 109, and looks broken rather than correct.
- The Facilities page takes ~10s to load — that is deliberate rate-limit
  pacing. Cut it, or start the shot after it lands.
- Record moment 3 and the Graph query in one session so the transaction hashes
  match on screen. That match is the proof.
