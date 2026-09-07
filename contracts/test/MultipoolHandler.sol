// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";

/// @dev Handler for multipool Layer-A (registry/factory) invariant fuzzing.
///
/// Drives random sequences of factory/registry operations across multiple PSPs:
///   createPool, secondPoolAttempt, closeViaUnsuccessful, closeViaClosed,
///   closeViaMaturity, reassignPspWallet, chainedReassign,
///   approvePsp, revokePsp, warpTime.
///
/// Layer A only — no economic invariants.  Pool economics neutered (aprAnnual=0,
/// idleRateDaily=0) so all terminal paths are reachable without yield/drawdown
/// settlement.
///
/// Three distinct close paths exercised:
///   Path 1 — Unsuccessful:  finalizeFunding with principal < softCap
///   Path 2 — Default-close: declareDefault with aprAnnual=0, no drawdowns
///                           → immediate Closed (yieldOwed=0, collectedPrincipal=principal)
///   Path 3 — Maturity-close: _checkFinality via claimYield at poolFinalityTs
///
/// ── Panic-catch pattern ───────────────────────────────────────────────────
///
///   try X { } catch Panic(uint256 code) { _recordPanic(...); } catch { }
///
/// Typed catch Panic(uint256) fires before bare catch{}.  A bare catch{}
/// never intercepts a Panic.  Do not regress to bare catch{} only — that
/// pattern swallowed two real bugs in this codebase.
/// ─────────────────────────────────────────────────────────────────────────
contract MultipoolHandler is Test {

    // ── Constants ─────────────────────────────────────────────────────────

    uint256 constant SCALE   = 1e12;
    uint256 constant D       = 86400;
    uint256 constant WAD     = 1e18;
    uint256 constant TENURE  = 30;
    uint256 constant MAX_POOLS = 32;

    // ── Actors ────────────────────────────────────────────────────────────

    address public MULTISIG  = address(0xDEAD1);
    address public DEPLOYER  = address(0xDEAD2);
    address public AGENT2    = address(0xDEAD3);
    address public LP_FUNDER = address(0xDEAD4);

    // 8 PSP slots.  Slots 0-3 start approved; 4-7 start unapproved.
    // Wider set gives more room for reassignment chains and slot recycling.
    uint256 constant N_PSPS = 8;
    address[N_PSPS] public PSPS;

    // ── Contracts ─────────────────────────────────────────────────────────

    MockStablecoin  public usdc;
    TreasuryReserve public treasury;
    PoolFactory     public factory;

    // ── Pool registry shadow ──────────────────────────────────────────────

    address[] public allPools;
    address[] public poolPsp;       // current PSP (updated on reassign)
    uint8[]   public poolPath;      // 0=live, 1=Unsuccessful, 2=DefaultClose, 3=MaturityClose

    // ── Ghost: coverage counters ──────────────────────────────────────────

    uint256 public ghost_poolsCreated;
    uint256 public ghost_secondPoolAttempts;   // every attempt against a live-PSP guard
    uint256 public ghost_reassignments;           // successful reassignPspWallet calls
    uint256 public ghost_reassignToActiveAttempts; // attempts where newPsp already holds a live pool — must revert
    uint256 public ghost_chainedReassigns;        // each leg of a chained reassign
    uint256 public ghost_pspsBitmap;

    // Per-close-path slot reuse counters
    uint256 public ghost_slotReuse_afterUnsuccessful;
    uint256 public ghost_slotReuse_afterDefault;
    uint256 public ghost_slotReuse_afterMaturity;

    // ── Ghost: panic detection ────────────────────────────────────────────

    bool    public ghost_panicDetected;
    uint256 public ghost_panicCode;
    string  public ghost_panicSite;
    string  public ghost_panicInfo;

    // ── Constructor ───────────────────────────────────────────────────────

    constructor() {
        vm.warp(0);

        for (uint256 i = 0; i < N_PSPS; i++) {
            PSPS[i] = address(uint160(0xA0000 + i));
        }

        usdc = new MockStablecoin();
        PoolContract impl = new PoolContract();
        treasury = new TreasuryReserve(
            address(usdc), MULTISIG,
            1e17, 1_000_000 * SCALE, WAD, 0
        );
        factory = new PoolFactory(
            MULTISIG, DEPLOYER, address(impl), address(treasury), address(usdc),
            30 * 86400, 25e16, 3, 1, 7
        );
        vm.prank(MULTISIG); treasury.setFactory(address(factory));

        // Approve slots 0-3; leave 4-7 unapproved (targets for reassign / approvePsp)
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(MULTISIG);
            factory.approvePsp(PSPS[i]);
        }

        usdc.mint(LP_FUNDER, 1_000_000_000 * SCALE);
    }

    // ── Internal ──────────────────────────────────────────────────────────

    function _recordPanic(uint256 code, string memory site) internal {
        if (!ghost_panicDetected) {
            ghost_panicDetected = true;
            ghost_panicCode     = code;
            ghost_panicSite     = site;
            ghost_panicInfo     = string.concat(
                "MULTIPOOL PANIC code=", vm.toString(code),
                " in ", site,
                " (17=overflow 18=div-by-zero 50=array-OOB)"
            );
        }
    }

    function _pspIdx(uint256 seed) internal pure returns (uint256) {
        return seed % N_PSPS;
    }

    function _factoryActivePool(address psp) internal view returns (address) {
        (, address ap) = factory.psps(psp);
        return ap;
    }

    function _factoryApproved(address psp) internal view returns (bool) {
        (bool ok, ) = factory.psps(psp);
        return ok;
    }

    // Update handler-side PSP tracking after a reassignment.
    function _updatePoolPsp(address oldPsp, address newPsp) internal {
        for (uint256 i = 0; i < poolPsp.length; i++) {
            if (poolPsp[i] == oldPsp) poolPsp[i] = newPsp;
        }
    }

    // Attempt a single reassignment.  Returns true on success.
    function _doReassign(uint256 oldIdx, uint256 newIdx) internal returns (bool) {
        if (oldIdx == newIdx) return false;
        address oldPsp = PSPS[oldIdx];
        address newPsp = PSPS[newIdx];
        if (!_factoryApproved(oldPsp)) return false;

        // If newPsp already holds a live pool, the contract guard must reject the call.
        // We exercise the path explicitly (not skip it) so a future guard removal shows
        // up as a ghost_panicDetected or unexpected success in the invariant suite.
        if (_factoryActivePool(newPsp) != address(0)) {
            ghost_reassignToActiveAttempts++;
            vm.prank(MULTISIG);
            try factory.reassignPspWallet(oldPsp, newPsp) {
                // Reaching here means the guard was removed — record as a panic site
                // so the campaign fails visibly.
                _recordPanic(0, "reassignToActive_guard_missing");
            } catch Panic(uint256 code) {
                _recordPanic(code, "reassignToActive");
            } catch { }
            return false;
        }

        vm.prank(MULTISIG);
        bool ok;
        try factory.reassignPspWallet(oldPsp, newPsp) {
            _updatePoolPsp(oldPsp, newPsp);
            ghost_reassignments++;
            ghost_pspsBitmap |= (1 << newIdx);
            ok = true;
        } catch Panic(uint256 code) {
            _recordPanic(code, "reassignPspWallet");
        } catch { }
        return ok;
    }

    // ── Handler: createPool ───────────────────────────────────────────────
    // Attempts createPool for a random PSP.  If the PSP has a live pool the
    // attempt is expected to revert (ghost_secondPoolAttempts incremented).

    function handler_createPool(uint256 pspSeed) external {
        if (allPools.length >= MAX_POOLS) return;

        uint256 idx = _pspIdx(pspSeed);
        address psp = PSPS[idx];
        if (!_factoryApproved(psp)) return;

        if (_factoryActivePool(psp) != address(0)) {
            ghost_secondPoolAttempts++;
            vm.prank(DEPLOYER);
            try factory.createPool(_poolParams(psp)) {
            } catch Panic(uint256 code) {
                _recordPanic(code, "createPool_liveGuard");
            } catch { }
            return;
        }

        _doCreatePool(idx, psp);
    }

    // ── Handler: secondPoolAttempt ────────────────────────────────────────
    // Dedicated handler: scans for any PSP with a live pool and attempts to
    // create a second pool for it.  Always hits the live-pool guard when a
    // live pool exists, generating guaranteed second-pool attempts at high
    // frequency without relying on random PSP selection.

    function handler_secondPoolAttempt(uint256 seed) external {
        // Find a PSP that currently has a live pool
        uint256 startIdx = _pspIdx(seed);
        for (uint256 i = 0; i < N_PSPS; i++) {
            uint256 idx = (startIdx + i) % N_PSPS;
            address psp = PSPS[idx];
            if (_factoryApproved(psp) && _factoryActivePool(psp) != address(0)) {
                ghost_secondPoolAttempts++;
                vm.prank(DEPLOYER);
                try factory.createPool(_poolParams(psp)) {
                } catch Panic(uint256 code) {
                    _recordPanic(code, "secondPoolAttempt_guard");
                } catch { }
                return; // one attempt per call
            }
        }
        // No live pool found — nothing to attempt
    }

    // ── Handler: closeViaUnsuccessful ─────────────────────────────────────
    // Path 1: Funding → Unsuccessful (no deposit, finalize after fMaturityTs).

    function handler_closeViaUnsuccessful(uint256 seed) external {
        if (allPools.length == 0) return;
        uint256 i = seed % allPools.length;
        if (poolPath[i] != 0) return;

        PoolContract p = PoolContract(allPools[i]);
        if (p.status() != PoolContract.Status.Funding) return;
        if (p.principal() >= p.softCap()) return;

        if (block.timestamp < p.fMaturityTs()) vm.warp(p.fMaturityTs());

        try p.finalizeFunding() {
            if (p.status() == PoolContract.Status.Unsuccessful) {
                poolPath[i] = 1; // Unsuccessful
            }
        } catch Panic(uint256 code) {
            _recordPanic(code, "closeViaUnsuccessful");
        } catch { }
    }

    // ── Handler: closeViaClosed (default path) ────────────────────────────
    // Path 2: Funding → Active → Closed via declareDefault.
    // aprAnnual=0 → yieldOwed=0 → immediate Closed with no drawdowns.

    function handler_closeViaClosed(uint256 seed) external {
        if (allPools.length == 0) return;
        uint256 i = seed % allPools.length;
        if (poolPath[i] != 0) return;

        PoolContract p = PoolContract(allPools[i]);
        PoolContract.Status s = p.status();

        if (s == PoolContract.Status.Funding) {
            if (block.timestamp >= p.fMaturityTs()) return;
            uint256 sc = p.softCap();
            if (usdc.balanceOf(LP_FUNDER) < sc) return;
            vm.prank(LP_FUNDER);
            try p.deposit(sc) {
            } catch Panic(uint256 code) {
                _recordPanic(code, "closeViaClosed_deposit");
                return;
            } catch { return; }

            if (block.timestamp < p.fMaturityTs()) vm.warp(p.fMaturityTs());
            try p.finalizeFunding() {
            } catch Panic(uint256 code) {
                _recordPanic(code, "closeViaClosed_finalize");
                return;
            } catch { return; }
        }

        s = p.status();
        if (s != PoolContract.Status.Active) return;

        vm.prank(AGENT2);
        try p.declareDefault() {
            if (p.status() == PoolContract.Status.Closed) {
                poolPath[i] = 2; // DefaultClose
            }
        } catch Panic(uint256 code) {
            _recordPanic(code, "closeViaClosed_declareDefault");
        } catch { }
    }

    // ── Handler: closeViaMaturity ─────────────────────────────────────────
    // Path 3: Funding → Active → Closed via _checkFinality (mature path).
    // Deposits softCap, locks, warps to poolFinalityTs, then calls claimYield
    // which invokes _mature() → _checkFinality() → Closed.

    function handler_closeViaMaturity(uint256 seed) external {
        if (allPools.length == 0) return;
        uint256 i = seed % allPools.length;
        if (poolPath[i] != 0) return;

        PoolContract p = PoolContract(allPools[i]);
        PoolContract.Status s = p.status();

        if (s == PoolContract.Status.Funding) {
            if (block.timestamp >= p.fMaturityTs()) return;
            uint256 sc = p.softCap();
            if (usdc.balanceOf(LP_FUNDER) < sc) return;
            vm.prank(LP_FUNDER);
            try p.deposit(sc) {
            } catch Panic(uint256 code) {
                _recordPanic(code, "closeViaMaturity_deposit");
                return;
            } catch { return; }

            if (block.timestamp < p.fMaturityTs()) vm.warp(p.fMaturityTs());
            try p.finalizeFunding() {
            } catch Panic(uint256 code) {
                _recordPanic(code, "closeViaMaturity_finalize");
                return;
            } catch { return; }
        }

        s = p.status();
        if (s != PoolContract.Status.Active) return;

        // Warp past poolFinalityTs so _checkFinality fires
        if (block.timestamp <= p.poolFinalityTs()) vm.warp(p.poolFinalityTs() + 1);

        // claimYield triggers _mature() → _checkFinality() → Closed (aprAnnual=0)
        // LP_FUNDER has a position from the deposit above
        vm.prank(LP_FUNDER);
        try p.claimYield() {
            if (p.status() == PoolContract.Status.Closed) {
                poolPath[i] = 3; // MaturityClose
            }
        } catch Panic(uint256 code) {
            _recordPanic(code, "closeViaMaturity_claimYield");
        } catch { }
    }

    // ── Handler: reassignPspWallet ────────────────────────────────────────
    // Reassigns from an approved PSP to another slot.
    // If newPsp has a live pool the contract guard must reject the call — the
    // handler exercises that path and records ghost_reassignToActiveAttempts
    // so the campaign fails visibly if the guard is ever removed.
    // Does NOT require newPsp to be unapproved — allows reassigning to an
    // approved PSP with an empty slot, enabling chained and back-reassignments.

    function handler_reassignPspWallet(uint256 oldSeed, uint256 newSeed) external {
        _doReassign(_pspIdx(oldSeed), _pspIdx(newSeed));
    }

    // ── Handler: chainedReassign ──────────────────────────────────────────
    // Performs two reassignments in one call: old→mid, then mid→new.
    // This is the primary driver of high reassignment counts and exercises
    // chained state (mid PSP gets the pool, then immediately hands it off).

    function handler_chainedReassign(uint256 s1, uint256 s2, uint256 s3) external {
        uint256 oldIdx = _pspIdx(s1);
        uint256 midIdx = _pspIdx(s2);
        uint256 newIdx = _pspIdx(s3);

        bool leg1 = _doReassign(oldIdx, midIdx);
        if (leg1) {
            ghost_chainedReassigns++;
            // mid now holds whatever old had; try to hand off to new
            if (_doReassign(midIdx, newIdx)) {
                ghost_chainedReassigns++;
            }
        }
    }

    // ── Handler: approvePsp ───────────────────────────────────────────────

    function handler_approvePsp(uint256 seed) external {
        uint256 idx = _pspIdx(seed);
        vm.prank(MULTISIG);
        try factory.approvePsp(PSPS[idx]) {
        } catch Panic(uint256 code) {
            _recordPanic(code, "approvePsp");
        } catch { }
    }

    // ── Handler: revokePsp ────────────────────────────────────────────────

    function handler_revokePsp(uint256 seed) external {
        uint256 idx = _pspIdx(seed);
        address psp = PSPS[idx];
        if (!_factoryApproved(psp)) return;
        if (_factoryActivePool(psp) != address(0)) return;
        vm.prank(MULTISIG);
        try factory.revokePsp(psp) {
        } catch Panic(uint256 code) {
            _recordPanic(code, "revokePsp");
        } catch { }
    }

    // ── Handler: warpTime ─────────────────────────────────────────────────

    function handler_warpTime(uint256 days_) external {
        days_ = bound(days_, 0, 10);
        vm.warp(block.timestamp + days_ * D);
    }

    // ── Internal: createPool helper ───────────────────────────────────────

    function _doCreatePool(uint256 idx, address psp) internal {
        bool isReuse = ((ghost_pspsBitmap >> idx) & 1) == 1;
        // Find the path that freed the slot, for per-path reuse tracking
        uint8 prevPath = _lastTerminalPathForPsp(psp);

        vm.prank(DEPLOYER);
        try factory.createPool(_poolParams(psp)) returns (address poolAddr) {
            allPools.push(poolAddr);
            poolPsp.push(psp);
            poolPath.push(0);

            ghost_poolsCreated++;
            ghost_pspsBitmap |= (1 << idx);

            if (isReuse) {
                if (prevPath == 1) ghost_slotReuse_afterUnsuccessful++;
                else if (prevPath == 2) ghost_slotReuse_afterDefault++;
                else if (prevPath == 3) ghost_slotReuse_afterMaturity++;
            }

            vm.prank(LP_FUNDER);
            usdc.approve(poolAddr, type(uint256).max);
        } catch Panic(uint256 code) {
            _recordPanic(code, "createPool");
        } catch { }
    }

    // Find the most recent terminal path for a PSP (for per-path slot reuse tracking).
    function _lastTerminalPathForPsp(address psp) internal view returns (uint8) {
        // Scan backwards to find the most recent terminal pool for this PSP
        for (uint256 i = poolPsp.length; i > 0; i--) {
            if (poolPsp[i - 1] == psp && poolPath[i - 1] != 0) {
                return poolPath[i - 1];
            }
        }
        return 0;
    }

    // ── Pool params ───────────────────────────────────────────────────────
    // aprAnnual=0, idleRateDaily=0 → no yield/idle economics.
    // declareDefault with no drawdowns → yieldOwed=0, collectedPrincipal=principal → immediate Closed.
    // _checkFinality at poolFinalityTs → same conditions → Closed.

    function _poolParams(address psp)
        internal
        view
        returns (PoolFactory.CreatePoolParams memory)
    {
        return PoolFactory.CreatePoolParams({
            pspWallet:         psp,
            fundingDurationSecs: 5 * 86400,
            softCap:           1 * SCALE,
            hardCap:           9_000_000 * SCALE,
            tenure:            TENURE,
            idleRateDaily:     0,
            utilizedRateDaily: 1,
            penaltyRateDaily:  2,
            penaltyGraceDays:  0,
            minDeposit:        0,
            aprAnnual:         0,
            agent1:            address(0xDEAD5),
            agent2:            AGENT2,
            multisig:          MULTISIG
        });
    }

    // ── Break-test helpers (called only by test_LA*_breakVerification) ───────

    // LA0: route a deliberate Panic(0x11) through the ghost recording path.
    // Confirms typed catch Panic(uint256) fires before bare catch{}.
    function helper_deliberatePanic() external pure returns (uint256) {
        uint256 x = 0;
        return x - 1; // Panic(0x11): arithmetic underflow
    }

    function helper_injectPanic_forTest() external {
        try this.helper_deliberatePanic() returns (uint256) {}
        catch Panic(uint256 code) { _recordPanic(code, "helper_injectPanic_forTest"); }
        catch {}
    }

    // ── Views ─────────────────────────────────────────────────────────────

    function poolCount() external view returns (uint256) { return allPools.length; }

    // Aggregate slot reuse across all paths
    function ghost_slotReuses() external view returns (uint256) {
        return ghost_slotReuse_afterUnsuccessful
             + ghost_slotReuse_afterDefault
             + ghost_slotReuse_afterMaturity;
    }
}
