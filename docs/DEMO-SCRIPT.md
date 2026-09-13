# DeFa — demo video script

**ETHOnline 2026 · Arc · Target 3:10 (hard bound 2–4 min)**

Adapted from the Solana cut (3:26). Arc replaces Solana throughout, ~55
seconds of transitional filler comes out, repayment goes in — the credit cycle
was never closed on camera — and The Graph and Privy each land where a viewer
is already asking the question they answer, rather than as an appendix.

---

## 0:00 – 0:15 · The problem — unchanged, it works

> Every cross-border payment needs capital before it can move. Payment service
> providers lock millions in advance funding accounts earning nothing, waiting
> days for bank lines. That is why we are building on-chain liquidity-as-a-
> service infrastructure **on Arc**.

**Change:** Solana → Arc. Add one clause, because it is the whole reason for
the chain choice:

> — Circle's stablecoin L1, where USDC is the native gas token, so the facility
> is funded, drawn and repaid in the same dollars the PSP already settles in.

---

## 0:15 – 0:27 · Onboarding (compress 12s → 8s)

> We run a 28-item onboarding: regulatory licence, jurisdictions, corridors,
> monthly transaction volumes.

Cut the list short on screen — scroll the form rather than reading items aloud.

---

## 0:27 – 0:48 · Droog and the KYR score — keep, it differentiates

> Once documents are in, our AI agent **Droog** accelerates the assessment.
> When the review completes it produces a Know Your Receivables score — KYR —
> 79 out of 100 here. Approved.

This is the answer to "how is undercollateralised lending safe", so it earns
its 20 seconds. Do not trim it to add flow steps back.

---

## 0:48 – 1:00 · Facility created on chain

> The admin sends the request on-chain and a facility is created against it.
> The terms the credit committee approved become the pool's parameters, and the
> borrower wallet is stamped in at creation — it cannot be changed afterwards.

**On screen:** pool address on [testnet.arcscan.app](https://testnet.arcscan.app),
borrower visible.

---

## 1:00 – 1:20 · Lenders fund it (was 1:04–1:44, cut ~20s)

> The facility opens for funding. Lenders browse live facilities — different
> terms, tenures and status — and deposit into the one they want.

**Cut entirely:** "every lender wants receivable-backed secure yields" (filler),
the repull-principal aside, and "now the facilities are approved and
initialized" (pure transition).

---

## 1:20 – 1:45 · The order book — strongest proof point, keep

> We are plugged directly into their order book. Every order is real, confirmed
> and visible to the system. The PSP cannot fabricate a drawdown — it has to
> match a real settlement order from their own platform.

---

## 1:45 – 2:05 · Validation gates + release

> When the PSP initiates a drawdown, our validation agents check five points. A
> single failure rejects it outright. Here all five pass, and the liquidity
> moves to the designated wallet.

**Cut:** the daily activity / P&L breakdown (20s) and the standalone KYR report
beat (6s) — KYR is already covered at 0:27.

---

## 2:05 – 2:20 · Privy — lands exactly here

The viewer has just watched a server release money. The next question is who
authorised that. Answer it now, not in an appendix.

> One server key can release that liquidity. It used to be a private key in an
> environment variable. It is now a Privy wallet with a policy — signing
> happens in their enclave, and anything that moves value is refused before a
> signature exists.

**On screen:** Privy dashboard → the policy's DENY rule. Then terminal:
zero-value call **signs**, value transfer **refused** —
`RPC request denied due to policy violation`.

> On Arc, USDC *is* the native token. That policy is the difference between a
> stolen key calling a contract and a stolen key taking the money.

⚠️ Do not film Privy's Settings → Basics page; the app secret is on it.

---

## 2:20 – 2:35 · Repayment — new, and the cycle needs it

The Solana cut never showed money coming back, which leaves the credit story
half-told.

> The draw is repaid on settlement. The contract computes the finance charge
> itself — per second, not per statement — and the line revolves: repaid
> principal becomes drawable again.

**On screen:** repay → **outstanding goes to 0.000000**, finance charge shown.

---

## 2:35 – 2:55 · The Graph — lands here

The viewer has now seen one facility. The obvious next question is how anyone
sees all of them.

> A credit book is a portfolio question. Which borrower is concentrated, which
> draw is past grace and accruing penalties, which facility hits maturity with
> money still out. Those answers cost one RPC call per pool per field — enough
> to trip the node's rate limiter, which is exactly what happened to us.
>
> So the read layer is a Subgraph, and this agent reasons over it.

**On screen, in order:**
1. Subgraph Studio — synced, endpoint visible (~4s)
2. Playground: the query returning the repayment from 2:20 — **freeze on the
   matching `txHash`** (~6s)
3. Terminal: `node agent/src/index.js --demo-clock` → the CRITICAL finding (~8s)

> The agent has no RPC client and no database. Switch The Graph off and it has
> nothing to think with.

---

## 2:55 – 3:10 · Close — keep, it is the best part

> PayMate handles the payment operators. Droog handles due diligence.
> Validation agents ensure every dollar goes against a real order. DeFa handles
> the capital. Every drawdown validated, every settlement tracked, every dollar
> audited.
>
> $860 billion a year moves through cross-border remittances. Trillions more
> through OTC and local payments. All of it needs pre-funding. None of it has
> an on-chain credit layer — until now.
>
> **DeFa is live on Arc testnet today.**

---

## What came out, and why

| Cut | Was | Why |
|---|---|---|
| "Every lender wants receivable-backed secure yields" | 7s | States the premise twice |
| Repull principal aside | 9s | Not the story; redemption is covered by repayment |
| "Now the facilities are approved and initialized…" | 10s | Pure transition |
| Daily activity / P&L breakdown | 20s | A dashboard, not a proof |
| Standalone KYR report beat | 6s | Already covered at 0:27 |

≈52s recovered; ~50s added for Privy, repayment and The Graph.

## Traps

- **Say the demo clock out loud, once**, at the first timing that looks odd:
  *"a contract day passes in a minute here, so a 30-day facility completes
  while you watch."* Without it the timings read as faked.
- **Never leave a drawdown open between takes.** Penalty accrues per contract
  day — a real minute. Left overnight, a 10 USDC draw shows a 109 USDC debt:
  correct, but it looks broken on camera.
- **Record the repayment and the Graph query in one session** so the hashes
  match on screen. That match is the proof.
- The Facilities page takes ~10s to load (deliberate rate-limit pacing). Cut
  it, or start the shot after it lands.

## Shot list

| # | Shot | Source |
|---|---|---|
| 1 | Advance-funding problem | slide |
| 2 | 28-item onboarding, scrolling | PSP portal |
| 3 | Droog assessment → KYR 79/100 | admin portal |
| 4 | Pool on arcscan, borrower visible | testnet.arcscan.app |
| 5 | Lender browsing facilities → deposit | lender portal |
| 6 | Order book, real orders | PSP portal |
| 7 | 5 validation gates passing | PSP portal |
| 8 | Liquidity arriving in wallet | MetaMask |
| 9 | Privy policy DENY rule | dashboard.privy.io |
| 10 | Privy: signs / refused | terminal |
| 11 | Repay → outstanding 0 | borrower portal |
| 12 | Studio synced + playground txHash | thegraph.com/studio |
| 13 | Risk agent CRITICAL finding | terminal |
