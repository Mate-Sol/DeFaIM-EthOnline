// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./MathLib.sol";
import "./ITreasuryReserve.sol";
import "./IPoolFactory.sol";

contract PoolContract is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using MathLib for uint256;

    // ── Roles ────────────────────────────────────────────────────────────────

    bytes32 public constant AGENT1_ROLE   = keccak256("AGENT1_ROLE");
    bytes32 public constant AGENT2_ROLE   = keccak256("AGENT2_ROLE");
    bytes32 public constant MULTISIG_ROLE = keccak256("MULTISIG_ROLE");

    // ── Enums ────────────────────────────────────────────────────────────────

    enum Status { Funding, Active, Unsuccessful, Closed, Default }

    // ── Structs ──────────────────────────────────────────────────────────────

    // 2D-turnaround (intended behavior): when a PSP repays advance A and draws advance B
    // on the same calendar day, each advance independently bills that shared day at the
    // utilized rate. The day is deployed capital on both sides — the idle exemption on
    // the repay side shields it from idle, so the day is unambiguously utilized from
    // both advances. Billing less would leave outstanding capital with no usage fee.
    // Do NOT treat this as a double-billing bug; it is correct-by-design.
    struct DrawDown {
        uint256 principal;
        uint256 startTs;
        uint256 expiryTs;
        address receiverWallet;
    }

    struct LPPosition {
        uint256 principal;
        uint256 fundingCredit;
        uint256 lastUpdate;
        uint256 dollarSeconds;
        uint256 claimedYield;
        uint256 claimedPrincipal;
        uint256 claimedOverrunYield;
        uint256 claimedBonus;
        bool    finalized;
    }

    // ── Init guard ───────────────────────────────────────────────────────────

    bool private _initialized;

    // ── Config (stamped at initialize, immutable per pool) ───────────────────

    uint256 public tenure;              // pool tenure in days
    uint256 public softCap;
    uint256 public hardCap;
    uint256 public aprAnnual;           // WAD
    uint256 public idleRateDaily;       // WAD
    uint256 public utilizedRateDaily;   // WAD
    uint256 public penaltyRateDaily;    // WAD
    uint256 public penaltyGraceDays;
    uint256 public minDeposit;
    uint256 public maxTenureSecs; // total pool life ceiling in seconds (admission guard only)

    // Frozen bounds (snapshot from factory at creation)
    uint256 public fundingDurationSecs;
    uint256 public fundingExecBufferDays; // stored as WAD fraction (e.g. 0.25 day -> 0.25e18)
    uint256 public maxGracePeriodDays;
    uint256 public minDdDays;
    uint256 public maxDdDays;
    address public pspWallet;
    address public treasury;
    address public stablecoin;
    address public factory;

    // ── Lifecycle ────────────────────────────────────────────────────────────

    Status  public status;
    uint256 public fundingStartTs;
    uint256 public fMaturityTs;
    uint256 public poolStartTs;
    uint256 public poolFinalityTs;
    uint256 public lastUpdate;
    uint256 public lastOverrunTs;
    uint256 public span;                // tenure * 86400 (seconds), set at lock

    // ── Economics ────────────────────────────────────────────────────────────

    uint256 public principal;
    uint256 public availableToDd;
    uint256 public outstanding;
    uint256 public fundingCredit;
    uint256 public dollarSeconds;
    uint256 public yieldOwed;           // LP coupon total (named yield in Python)
    uint256 public overrunYield;
    uint256 public accIdleFees;
    uint256 public accPenalty;
    uint256 public collectedPrincipal;
    uint256 public collectedYield;
    uint256 public collectedOverrunYield;
    uint256 public reservedYield;
    uint256 public protocolFees;
    uint256 public collectedBonus;
    uint256 public claimedYield;
    uint256 public claimedOverrunYield;
    uint256 public claimedPrincipal;
    uint256 public claimedBonus;

    // ── V2 idle-fee day tracking ──────────────────────────────────────────────

    uint256 public lastIdleDay;       // highest calendar day already billed for idle
    uint256 public lastPenaltyDay;    // highest calendar day already billed for idle penalty
    uint256 public idleExemptAmount;  // capital currently exempt from idle (WAD-scaled)
    uint256 public idleExemptUntil;   // timestamp when exemption releases (next UTC midnight)

    // ── Circuit breaker ──────────────────────────────────────────────────────

    bool public paused;
    bool public scOverdueCheck;

    // ── Release guard ────────────────────────────────────────────────────────

    bool private _pspReleased;

    // ── Collections ──────────────────────────────────────────────────────────

    mapping(address => bool)      public authorizedReceivers;
    mapping(address => uint256)   public receiverActiveDrawdowns;
    mapping(bytes32 => DrawDown)  public drawDowns;
    bytes32[]                     public drawDownRefs;
    mapping(bytes32 => uint256)   public refIndex; // 1-indexed position in drawDownRefs
    mapping(address => LPPosition) public lpPositions;

    // ── Events ───────────────────────────────────────────────────────────────

    event Deposit(address indexed lp, uint256 amount);
    event Withdraw(address indexed lp, uint256 amount);
    event Locked(uint256 poolStartTs, uint256 poolFinalityTs, uint256 dollarSeconds, uint256 yieldOwed);
    event FundingFailed();
    event ReceiverAdded(address indexed receiver);
    event ReceiverRemoved(address indexed receiver);
    event DrawdownExecuted(bytes32 indexed ref, address indexed receiver, uint256 amount);
    event Repaid(bytes32 indexed ref, uint256 principal, uint256 financeCharge);
    event IdleFeesPaid(uint256 amount);
    event YieldClaimed(address indexed lp, uint256 amount);
    event PrincipalClaimed(address indexed lp, uint256 amount);
    event DefaultDeclared();
    event DefaultSettledPrincipal(uint256 paid, uint256 fromDirect, uint256 fromReserve);
    event DefaultSettledYield(uint256 paid, uint256 fromDirect, uint256 fromReserve);
    event PoolClosed();
    event ProtocolFeesSwept(uint256 amount);
    event PspWalletUpdated(address newWallet);
    event PoolPaused(bool paused);
    event ScOverdueSet(bool enabled);

    // ── Constructor: lock the implementation against direct initialization ──────

    /// @dev Prevents anyone from calling initialize() on the raw implementation.
    ///      EIP-1167 clones own independent storage and are unaffected.
    ///      Equivalent to OZ Initializable._disableInitializers().
    constructor() {
        _initialized = true;
    }

    // ── Initialize (factory-only, once) ──────────────────────────────────────

    struct InitParams {
        address pspWallet;
        uint256 softCap;
        uint256 hardCap;
        uint256 tenure;
        uint256 idleRateDaily;       // WAD
        uint256 utilizedRateDaily;   // WAD
        uint256 penaltyRateDaily;    // WAD
        uint256 penaltyGraceDays;
        uint256 minDeposit;
        uint256 aprAnnual;           // WAD
        uint256 fundingDurationSecs;
        uint256 fundingExecBufferDays; // WAD fraction of a day
        uint256 maxGracePeriodDays;
        uint256 minDdDays;
        uint256 maxDdDays;
        address treasury;
        address stablecoin;
        address agent1;
        address agent2;
        address multisig;
    }

    function initialize(InitParams calldata p) external {
        require(!_initialized, "Pool: already initialized");
        _initialized = true;
        factory = msg.sender;

        // Config
        pspWallet         = p.pspWallet;
        softCap           = p.softCap;
        hardCap           = p.hardCap;
        tenure            = p.tenure;
        idleRateDaily     = p.idleRateDaily;
        utilizedRateDaily = p.utilizedRateDaily;
        penaltyRateDaily  = p.penaltyRateDaily;
        penaltyGraceDays  = p.penaltyGraceDays;
        minDeposit        = p.minDeposit;
        aprAnnual         = p.aprAnnual;
        treasury          = p.treasury;
        stablecoin        = p.stablecoin;

        // Frozen bounds
        fundingDurationSecs   = p.fundingDurationSecs;
        fundingExecBufferDays = p.fundingExecBufferDays;
        maxGracePeriodDays    = p.maxGracePeriodDays;
        minDdDays             = p.minDdDays;
        maxDdDays             = p.maxDdDays;

        // Snap fMaturityTs to the next UTC midnight so poolFinalityTs is always midnight-aligned.
        uint256 fMaturityRaw = block.timestamp + p.fundingDurationSecs;
        uint256 fRemainder   = fMaturityRaw % MathLib.SECONDS_PER_DAY;
        uint256 snapSecs     = fRemainder == 0 ? 0 : MathLib.SECONDS_PER_DAY - fRemainder;

        // maxTenureSecs: total pool life ceiling in seconds, including the midnight snap.
        // Buffer converted to seconds via mulDiv to preserve the fractional day (e.g. 0.25*D = 21600 s).
        // SYNC: formula must stay identical to PoolFactory.createPool() maxTenureSecs local variable.
        maxTenureSecs = p.fundingDurationSecs
            + snapSecs
            + MathLib.mulDiv(p.fundingExecBufferDays, MathLib.SECONDS_PER_DAY, MathLib.WAD)
            + p.tenure * MathLib.SECONDS_PER_DAY
            + p.penaltyGraceDays * MathLib.SECONDS_PER_DAY;

        // Roles
        _grantRole(DEFAULT_ADMIN_ROLE, p.multisig);
        _grantRole(MULTISIG_ROLE,      p.multisig);
        _grantRole(AGENT1_ROLE,        p.agent1);
        _grantRole(AGENT2_ROLE,        p.agent2);

        // Lifecycle
        status         = Status.Funding;
        fundingStartTs = block.timestamp;
        fMaturityTs    = fMaturityRaw + snapSecs;  // next UTC midnight after funding period
        lastUpdate     = block.timestamp;
        scOverdueCheck = true;

        // Auto-authorize the PSP wallet as a receiver. The PSP is already
        // multisig-approved at the factory level; this removes the mandatory
        // addReceiver(pspWallet) call in the common single-receiver case.
        authorizedReceivers[p.pspWallet] = true;
        emit ReceiverAdded(p.pspWallet);
    }

    // ── LP: deposit ──────────────────────────────────────────────────────────

    function deposit(uint256 amount) external nonReentrant {
        _triggerFinalizeFunding();
        require(status == Status.Funding, "Pool: not funding");
        require(amount >= minDeposit, "Pool: below min deposit");
        require(principal + amount <= hardCap, "Pool: exceeds hard cap");

        _globalCheckpoint();
        _lpCheckpoint(msg.sender);

        IERC20(stablecoin).safeTransferFrom(msg.sender, address(this), amount);

        LPPosition storage pos = lpPositions[msg.sender];
        pos.principal += amount;
        principal     += amount;

        emit Deposit(msg.sender, amount);
    }

    // ── LP: withdraw ─────────────────────────────────────────────────────────

    function withdraw(uint256 amount) external nonReentrant {
        _triggerFinalizeFunding();
        require(
            status == Status.Funding || status == Status.Unsuccessful,
            "Pool: cannot withdraw"
        );

        LPPosition storage pos = lpPositions[msg.sender];
        require(amount > 0 && amount <= pos.principal, "Pool: bad withdraw amount");
        uint256 remaining = pos.principal - amount;
        require(remaining == 0 || remaining >= minDeposit, "Pool: remainder below minDeposit");

        _globalCheckpoint();
        _lpCheckpoint(msg.sender);

        // Forfeit proportional funding credit
        uint256 forfeited = pos.fundingCredit.mulDiv(amount, pos.principal);
        pos.fundingCredit -= forfeited;
        fundingCredit     -= forfeited;

        pos.principal -= amount;
        principal     -= amount;

        IERC20(stablecoin).safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, amount);
    }

    // ── Funding finalization (public + lazily triggered) ─────────────────────

    function finalizeFunding() external {
        _triggerFinalizeFunding();
    }

    function _triggerFinalizeFunding() internal {
        // Allow finalization from fMaturityTs up to the buffer deadline.
        // Once past the buffer deadline, the next call flips the pool Unsuccessful.
        uint256 bufferSecs = MathLib.mulDiv(fundingExecBufferDays, MathLib.SECONDS_PER_DAY, MathLib.WAD);
        if (status == Status.Funding && block.timestamp >= fMaturityTs) {
            _finalizeFunding(bufferSecs);
        }
    }

    function _finalizeFunding(uint256 bufferSecs) internal {
        // Sync fundingCredit while status is still Funding so that global and
        // per-LP credits remain balanced on the Unsuccessful path.
        _globalCheckpoint();
        uint256 bufferDeadline = fMaturityTs + bufferSecs;
        if (principal >= softCap && block.timestamp <= bufferDeadline) {
            _lock();
        } else {
            status = Status.Unsuccessful;
            emit FundingFailed();
            _releasePsp();
        }
    }

    // Kept for external callers that invoke finalizeFunding() directly.
    function _finalizeFunding() internal {
        uint256 bufferSecs = MathLib.mulDiv(fundingExecBufferDays, MathLib.SECONDS_PER_DAY, MathLib.WAD);
        _finalizeFunding(bufferSecs);
    }

    // ── Internal: lock ────────────────────────────────────────────────────────

    function _lock() internal {
        _globalCheckpoint();
        uint256 t = block.timestamp;
        poolStartTs    = t;
        span           = tenure * MathLib.SECONDS_PER_DAY;
        // Anchor poolFinalityTs to fMaturityTs so it is always UTC-midnight-aligned,
        // regardless of actual finalize latency within the buffer window.
        poolFinalityTs = fMaturityTs + span;
        dollarSeconds  = fundingCredit + principal * span;
        yieldOwed      = MathLib.mulDiv(dollarSeconds, aprAnnual, MathLib.WAD * MathLib.SECONDS_PER_YEAR);
        availableToDd  = principal;
        lastUpdate     = t;
        lastOverrunTs  = poolFinalityTs;
        // Idle-day tracking (v2): start billing from the lock calendar day.
        lastIdleDay    = MathLib.dayOf(t);
        lastPenaltyDay = MathLib.dayOf(poolFinalityTs) + penaltyGraceDays;
        status         = Status.Active;
        emit Locked(t, poolFinalityTs, dollarSeconds, yieldOwed);
    }

    // ── Agent-2: executeDrawdown ──────────────────────────────────────────────
    // The agent executes drawdowns directly to pre-authorized receivers.
    // All validation gates (including the overdue circuit-breaker) run before any
    // state mutation or accrual, matching the pseudocode oracle ordering.

    function executeDrawdown(
        bytes32 ref,
        address receiverWallet,
        uint256 amount,
        uint256 settlementDays
    ) external onlyRole(AGENT2_ROLE) nonReentrant {
        require(status == Status.Active,                   "Pool: not active");
        require(receiverWallet != address(0),              "Pool: zero receiver");
        require(authorizedReceivers[receiverWallet],       "Pool: receiver not authorized");
        require(amount > 0,                                "Pool: zero amount");
        require(drawDowns[ref].principal == 0,             "Pool: ref exists");
        require(settlementDays >= minDdDays && settlementDays <= maxDdDays, "Pool: bad settlementDays");

        uint256 expiryTs = block.timestamp + (settlementDays - 1) * MathLib.SECONDS_PER_DAY;
        require(
            MathLib.dayOf(expiryTs) <= MathLib.dayOf(poolFinalityTs),
            "Pool: expiry past maturity"
        );
        require(amount <= availableToDd, "Pool: insufficient liquidity");
        require(!_hasOverdueUnsettled(), "Pool: overdue drawdown");

        _accrueIdleFees();
        _accrueExtensionYield();

        drawDowns[ref] = DrawDown({
            principal:      amount,
            startTs:        block.timestamp,
            expiryTs:       expiryTs,
            receiverWallet: receiverWallet
        });
        drawDownRefs.push(ref);
        refIndex[ref] = drawDownRefs.length; // 1-indexed

        availableToDd -= amount;
        outstanding   += amount;
        receiverActiveDrawdowns[receiverWallet]++;

        if (idleExemptAmount > 0) {
            if (amount >= idleExemptAmount) {
                idleExemptAmount = 0;
                idleExemptUntil  = 0;
            } else {
                idleExemptAmount -= amount;
            }
        }

        IERC20(stablecoin).safeTransfer(receiverWallet, amount);
        emit DrawdownExecuted(ref, receiverWallet, amount);
    }

    // ── Agent-1 / Multisig: receiver whitelist management ────────────────────

    function addReceiver(address receiverWallet)
        external
    {
        require(
            hasRole(AGENT1_ROLE, msg.sender) || hasRole(MULTISIG_ROLE, msg.sender),
            "Pool: not agent or multisig"
        );
        require(
            status == Status.Funding || status == Status.Active,
            "Pool: terminal state"
        );
        require(receiverWallet != address(0),          "Pool: zero receiver");
        require(!authorizedReceivers[receiverWallet],  "Pool: already authorized");
        authorizedReceivers[receiverWallet] = true;
        emit ReceiverAdded(receiverWallet);
    }

    function removeReceiver(address receiverWallet)
        external
        onlyRole(MULTISIG_ROLE)
    {
        require(
            status == Status.Funding || status == Status.Active,
            "Pool: terminal state"
        );
        require(authorizedReceivers[receiverWallet], "Pool: not authorized");
        require(receiverActiveDrawdowns[receiverWallet] == 0, "Pool: live drawdown");
        authorizedReceivers[receiverWallet] = false;
        emit ReceiverRemoved(receiverWallet);
    }

    // ── PSP: repay ───────────────────────────────────────────────────────────

    function repay(bytes32 ref) external nonReentrant {
        require(authorizedReceivers[msg.sender], "Pool: not authorized receiver");
        require(status == Status.Active, "Pool: not active");
        DrawDown storage dd = drawDowns[ref];
        require(dd.principal > 0, "Pool: no drawdown");

        _accrueIdleFees();
        _accrueExtensionYield();

        uint256 ddAmount  = dd.principal;
        uint256 ddStart   = dd.startTs;
        uint256 expiryTs  = dd.expiryTs;
        address ddReceiver = dd.receiverWallet;

        uint256 dueDayOffset  = (expiryTs - ddStart) / MathLib.SECONDS_PER_DAY;
        uint256 elapsedDays   = MathLib.dayOf(block.timestamp) - MathLib.dayOf(ddStart);
        uint256 penaltyStart  = _penaltyStartDay(dueDayOffset);
        uint256 daysTotal     = elapsedDays + 1;
        uint256 stdDays       = daysTotal < penaltyStart ? daysTotal : penaltyStart;
        if (stdDays < minDdDays) stdDays = minDdDays;
        uint256 penDays       = daysTotal > penaltyStart ? daysTotal - penaltyStart : 0;

        uint256 financeCharge = MathLib.mulDiv(
            ddAmount,
            stdDays * utilizedRateDaily + penDays * penaltyRateDaily,
            MathLib.WAD
        );

        uint256 total = ddAmount + financeCharge;

        // CEI: update state before transfer.
        // block.timestamp vs poolFinalityTs: design is day-granular; second-level drift is immaterial.
        if (block.timestamp < poolFinalityTs) {
            availableToDd += ddAmount;
            // Exempt returned capital from idle on the repay calendar day.
            // The exemption releases at the next UTC midnight (idle-exempt capital is
            // considered "utilized through end of repay day" — no double-billing).
            idleExemptAmount += ddAmount;
            idleExemptUntil   = (MathLib.dayOf(block.timestamp) + 1) * MathLib.SECONDS_PER_DAY;
        } else {
            collectedPrincipal += ddAmount;
        }
        outstanding -= ddAmount;

        // Remove from drawDownRefs (swap-and-pop) and release receiver slot.
        _removeDrawDown(ref);
        if (receiverActiveDrawdowns[ddReceiver] > 0) receiverActiveDrawdowns[ddReceiver]--;

        IERC20(stablecoin).safeTransferFrom(msg.sender, address(this), total);

        _allocate(financeCharge);
        _mature();

        emit Repaid(ref, ddAmount, financeCharge);
    }

    // ── PSP: payAccruedIdleFees ──────────────────────────────────────────────

    function payAccruedIdleFees(uint256 amount) external nonReentrant {
        require(authorizedReceivers[msg.sender], "Pool: not authorized receiver");
        require(amount > 0, "Pool: zero amount");
        require(status == Status.Active, "Pool: not active");

        _accrueIdleFees();
        _accrueExtensionYield();

        uint256 owed = accIdleFees + accPenalty;
        uint256 pay  = amount < owed ? amount : owed;
        if (pay == 0) return;

        if (pay >= owed) {
            accIdleFees = 0;
            accPenalty  = 0;
        } else {
            uint256 payFees = pay < accIdleFees ? pay : accIdleFees;
            accIdleFees -= payFees;
            accPenalty  -= (pay - payFees);
        }

        IERC20(stablecoin).safeTransferFrom(msg.sender, address(this), pay);

        _allocate(pay);
        _mature();

        emit IdleFeesPaid(pay);
    }

    // ── LP: claimYield ────────────────────────────────────────────────────────

    function claimYield() external nonReentrant {
        require(
            status == Status.Active || status == Status.Closed || status == Status.Default,
            "Pool: cannot claim"
        );
        require(lpPositions[msg.sender].principal > 0, "Pool: no position");

        _accrueIdleFees();
        _accrueExtensionYield();
        _settleLpDollarSeconds(msg.sender);
        _mature();

        LPPosition storage pos = lpPositions[msg.sender];

        // Base yield share (dollar-seconds)
        uint256 baseShare = MathLib.mulDiv(pos.dollarSeconds, MathLib.WAD, dollarSeconds);

        // F1 cap: pre-maturity in-flight accrual.
        // block.timestamp drift is immaterial: worst case is one day's accrual difference, fractions of a cent.
        if (status == Status.Active && block.timestamp < poolFinalityTs) {
            uint256 elapsed      = block.timestamp - poolStartTs;
            uint256 dsPoolElapsed = fundingCredit + principal * elapsed;
            if (dsPoolElapsed > 0) {
                uint256 dsLpElapsed  = pos.fundingCredit + pos.principal * elapsed;
                uint256 elapsedShare = MathLib.mulDiv(dsLpElapsed, MathLib.WAD, dsPoolElapsed);
                if (elapsedShare < baseShare) baseShare = elapsedShare;
            }
        }

        uint256 baseOwed    = MathLib.mulDiv(baseShare, collectedYield, MathLib.WAD);
        uint256 overrunOwed = MathLib.mulDiv(pos.principal, collectedOverrunYield, principal);
        uint256 bonusOwed   = MathLib.mulDiv(pos.principal, collectedBonus, principal);

        uint256 claimableBase   = baseOwed     > pos.claimedYield         ? baseOwed     - pos.claimedYield         : 0;
        uint256 claimableOverrun = overrunOwed > pos.claimedOverrunYield  ? overrunOwed  - pos.claimedOverrunYield  : 0;
        uint256 claimableBonus  = bonusOwed    > pos.claimedBonus         ? bonusOwed    - pos.claimedBonus         : 0;

        // Pool-level caps
        uint256 poolYieldLeft   = collectedYield         - claimedYield;
        uint256 poolOverrunLeft = collectedOverrunYield  - claimedOverrunYield;
        uint256 poolBonusLeft   = collectedBonus         - claimedBonus;
        if (claimableBase   > poolYieldLeft)   claimableBase   = poolYieldLeft;
        if (claimableOverrun > poolOverrunLeft) claimableOverrun = poolOverrunLeft;
        if (claimableBonus  > poolBonusLeft)   claimableBonus  = poolBonusLeft;

        uint256 claimable = claimableBase + claimableOverrun + claimableBonus;
        if (claimable == 0) return;

        pos.claimedYield         += claimableBase;
        pos.claimedOverrunYield  += claimableOverrun;
        pos.claimedBonus         += claimableBonus;
        claimedYield             += claimableBase;
        claimedOverrunYield      += claimableOverrun;
        claimedBonus             += claimableBonus;

        IERC20(stablecoin).safeTransfer(msg.sender, claimable);
        emit YieldClaimed(msg.sender, claimable);
    }

    // ── LP: claimPrincipal ────────────────────────────────────────────────────

    function claimPrincipal() external nonReentrant {
        require(
            status == Status.Active || status == Status.Closed || status == Status.Default,
            "Pool: cannot claim"
        );
        require(lpPositions[msg.sender].principal > 0, "Pool: no position");

        _accrueIdleFees();
        _mature();

        LPPosition storage pos = lpPositions[msg.sender];

        uint256 principalOwed = MathLib.mulDiv(pos.principal, collectedPrincipal, principal);
        uint256 claimable = principalOwed > pos.claimedPrincipal
            ? principalOwed - pos.claimedPrincipal
            : 0;
        if (claimable == 0) return;

        pos.claimedPrincipal += claimable;
        claimedPrincipal     += claimable;

        IERC20(stablecoin).safeTransfer(msg.sender, claimable);
        emit PrincipalClaimed(msg.sender, claimable);
    }

    // ── Agent-2: declareDefault ───────────────────────────────────────────────

    function declareDefault() external onlyRole(AGENT2_ROLE) nonReentrant {
        require(status == Status.Active, "Pool: not active");

        _accrueIdleFees();
        _accrueExtensionYield();

        uint256 t = block.timestamp;

        // Move undrawn principal to collected; clear idle exemption (terminal event).
        // receiverActiveDrawdowns is intentionally NOT cleared here. The pool is entering
        // a terminal state; executeDrawdown (Active-only) and addReceiver (Funding/Active-only)
        // can no longer be called, so the stale counter is never read in a meaningful context.
        // A future change that re-enables any receiver operation on a terminal pool must
        // reconcile this desync explicitly before relying on the counter.
        collectedPrincipal += availableToDd;
        availableToDd       = 0;
        idleExemptAmount    = 0;
        idleExemptUntil     = 0;

        // Pre-maturity: rebase LP coupon to actual elapsed time if that earned more
        if (t < poolFinalityTs) {
            uint256 elapsed = t - poolStartTs;
            uint256 dsElapsed = fundingCredit + principal * elapsed;
            uint256 earned    = MathLib.mulDiv(dsElapsed, aprAnnual, MathLib.WAD * MathLib.SECONDS_PER_YEAR);
            if (earned > collectedYield) {
                span          = elapsed;
                dollarSeconds = dsElapsed;
                yieldOwed     = earned;
            } else {
                yieldOwed = collectedYield;
            }
        }

        // Flush reserved_yield + protocol_fees into priority buckets
        uint256 amt = reservedYield + protocolFees;
        reservedYield = 0;
        protocolFees  = 0;

        uint256 toBase = yieldOwed > collectedYield ? yieldOwed - collectedYield : 0;
        if (toBase > amt) toBase = amt;
        collectedYield += toBase;
        amt -= toBase;

        uint256 toOverrun = overrunYield > collectedOverrunYield ? overrunYield - collectedOverrunYield : 0;
        if (toOverrun > amt) toOverrun = amt;
        collectedOverrunYield += toOverrun;
        amt -= toOverrun;

        uint256 toPrincipal = outstanding < amt ? outstanding : amt;
        collectedPrincipal += toPrincipal;
        outstanding        -= toPrincipal;
        amt                -= toPrincipal;

        protocolFees = amt; // remainder

        // Resolve immediately if all obligations met.
        // No terminal split here: the waterfall consumed reserved_yield + protocol_fees to
        // rescue the pool (fill yield → overrun → principal). Any residue in protocol_fees
        // is surplus that was already re-allocated, not a genuine protocol income surplus.
        if (collectedYield     >= yieldOwed &&
            collectedOverrunYield >= overrunYield &&
            collectedPrincipal >= principal)
        {
            // Inline Default→Closed: _settleTerminalSplit is NOT called.
            // collectedBonus stays 0 — same reasoning as the settleDefaultPrincipal/Yield close paths.
            status = Status.Closed;
            emit PoolClosed();
            _releasePsp();
        } else {
            status = Status.Default;
            emit DefaultDeclared();
        }
    }

    // ── Multisig: settleDefaultPrincipal ─────────────────────────────────────

    function settleDefaultPrincipal(uint256 amount) external onlyRole(MULTISIG_ROLE) nonReentrant {
        require(status == Status.Default, "Pool: not default");

        uint256 owed = principal > collectedPrincipal ? principal - collectedPrincipal : 0;
        if (owed == 0) {
            _resolveDefaultIfWhole();
            return;
        }

        uint256 fromAmount = amount < owed ? amount : owed;

        // Draw from reserve to cover remaining shortfall after direct payment
        uint256 remainingAfterAmount = owed - fromAmount;
        uint256 fromReserve = 0;
        if (remainingAfterAmount > 0) {
            fromReserve = ITreasuryReserve(treasury).drawReserve(remainingAfterAmount);
        }

        uint256 paid = fromAmount + fromReserve;
        if (paid == 0) return;

        // Pull direct contribution from multisig
        if (fromAmount > 0) {
            IERC20(stablecoin).safeTransferFrom(msg.sender, address(this), fromAmount);
        }
        // Reserve funds arrive via drawReserve (transferred from treasury to this contract)

        collectedPrincipal += paid;
        outstanding        -= paid;

        if (collectedYield     >= yieldOwed &&
            collectedOverrunYield >= overrunYield &&
            collectedPrincipal >= principal)
        {
            // Default→Closed: _settleTerminalSplit is NOT called on this path.
            // collectedBonus stays 0 — LPs receive no bonus on a default-recovery close.
            // The terminal split (reserve top-up + LP bonus carve) is a normal-maturity
            // feature; in default recovery the waterfall consumed all surplus to cover
            // obligations, leaving no meaningful residual to split.
            status = Status.Closed;
            emit PoolClosed();
            _releasePsp();
        }

        emit DefaultSettledPrincipal(paid, fromAmount, fromReserve);
    }

    // ── Multisig: settleDefaultYield ─────────────────────────────────────────

    function settleDefaultYield(uint256 amount) external onlyRole(MULTISIG_ROLE) nonReentrant {
        require(status == Status.Default, "Pool: not default");
        require(collectedPrincipal >= principal, "Pool: settle principal first");

        uint256 yieldShort   = yieldOwed > collectedYield ? yieldOwed - collectedYield : 0;
        uint256 overrunShort = overrunYield > collectedOverrunYield ? overrunYield - collectedOverrunYield : 0;
        uint256 owed = yieldShort + overrunShort;
        if (owed == 0) {
            _resolveDefaultIfWhole();
            return;
        }

        uint256 fromAmount  = amount < owed ? amount : owed;
        uint256 fromReserve = 0;
        uint256 remaining   = owed - fromAmount;
        if (remaining > 0) {
            fromReserve = ITreasuryReserve(treasury).drawReserve(remaining);
        }

        uint256 pay = fromAmount + fromReserve;
        if (pay == 0) return;

        if (fromAmount > 0) {
            IERC20(stablecoin).safeTransferFrom(msg.sender, address(this), fromAmount);
        }

        uint256 toYield = yieldShort < pay ? yieldShort : pay;
        collectedYield += toYield;
        pay -= toYield;
        uint256 toOverrun = overrunShort < pay ? overrunShort : pay;
        collectedOverrunYield += toOverrun;

        if (collectedYield     >= yieldOwed &&
            collectedOverrunYield >= overrunYield &&
            collectedPrincipal >= principal)
        {
            // Default→Closed: _settleTerminalSplit is NOT called on this path.
            // collectedBonus stays 0 — same reasoning as the settleDefaultPrincipal close path.
            status = Status.Closed;
            emit PoolClosed();
            _releasePsp();
        }

        emit DefaultSettledYield(fromAmount + fromReserve, fromAmount, fromReserve);
    }

    // ── Multisig: sweepProtocolFees ───────────────────────────────────────────

    function sweepProtocolFees() external onlyRole(MULTISIG_ROLE) nonReentrant {
        require(status == Status.Closed, "Pool: not closed");
        uint256 amount = protocolFees;
        require(amount > 0, "Pool: nothing to sweep");
        protocolFees = 0;
        IERC20(stablecoin).forceApprove(treasury, amount);
        ITreasuryReserve(treasury).depositImFees(amount);
        emit ProtocolFeesSwept(amount);
    }

    // ── Multisig: setPspWallet ────────────────────────────────────────────────

    function setPspWallet(address newWallet) external {
        require(
            hasRole(MULTISIG_ROLE, msg.sender) || msg.sender == factory,
            "Pool: unauthorized"
        );
        require(newWallet != address(0), "Pool: zero wallet");
        pspWallet = newWallet;
        emit PspWalletUpdated(newWallet);
    }

    // ── Agent-1: circuit breaker ──────────────────────────────────────────────

    function setScOverdue(bool enabled) external onlyRole(AGENT1_ROLE) {
        if (!enabled) {
            // When disabling, check if any drawdown is actually overdue
            bool anyOverdue = false;
            uint256 nowDay = MathLib.dayOf(block.timestamp);
            for (uint256 i = 0; i < drawDownRefs.length; i++) {
                DrawDown storage dd = drawDowns[drawDownRefs[i]];
                uint256 dueDayOffset = (dd.expiryTs - dd.startTs) / MathLib.SECONDS_PER_DAY;
                if (nowDay - MathLib.dayOf(dd.startTs) >= _penaltyStartDay(dueDayOffset)) {
                    anyOverdue = true;
                    break;
                }
            }
            paused = anyOverdue;
            emit PoolPaused(anyOverdue);
        }
        scOverdueCheck = enabled;
        emit ScOverdueSet(enabled);
    }

    function setPaused(bool _paused) external onlyRole(AGENT1_ROLE) {
        require(!scOverdueCheck, "Pool: sc mode on");
        paused = _paused;
        emit PoolPaused(_paused);
    }

    // ── Internal: accruals ────────────────────────────────────────────────────

    function _accrueIdleFees() internal {
        if (poolFinalityTs == 0) return;  // not yet locked
        if (status == Status.Default) return;
        if (status == Status.Closed)  return;

        uint256 t        = block.timestamp;
        uint256 maturity = poolFinalityTs;

        // ── Idle accrual (per calendar day, v2 model) ────────────────────────────
        // Bill each complete calendar day in [_day(poolStartTs), _day(maturity) - 1].
        // Exempt days where capital was returned that day (same-day-repay exemption).
        uint256 lastBillableDay = MathLib.dayOf(maturity) - 1;
        uint256 startDay        = MathLib.dayOf(poolStartTs);
        uint256 currentDay      = MathLib.dayOf(t);
        if (currentDay > lastBillableDay + 1) currentDay = lastBillableDay + 1;

        uint256 frm = lastIdleDay > startDay ? lastIdleDay : startDay;
        uint256 to  = currentDay;

        if (to > frm) {
            uint256 N     = to - frm;
            uint256 avail = availableToDd;
            uint256 rate  = idleRateDaily;

            // Split N days into exempt-adjusted (nExempt) and full (nFull) segments.
            uint256 nExempt = 0;
            if (idleExemptAmount > 0 && idleExemptUntil > 0) {
                uint256 euDay = MathLib.dayOf(idleExemptUntil);
                if (euDay > frm) {
                    nExempt = euDay > to ? N : euDay - frm;
                }
            }
            uint256 nFull = N - nExempt;

            if (nExempt > 0) {
                uint256 exemptBase = avail > idleExemptAmount ? avail - idleExemptAmount : 0;
                accIdleFees += MathLib.mulDiv(exemptBase * nExempt, rate, MathLib.WAD);
            }
            if (nFull > 0) {
                accIdleFees += MathLib.mulDiv(avail * nFull, rate, MathLib.WAD);
            }
            if (to > lastIdleDay) lastIdleDay = to;
        }

        // Release exemption once we have billed past its whole-day boundary.
        if (idleExemptUntil > 0 && lastIdleDay >= MathLib.dayOf(idleExemptUntil)) {
            idleExemptAmount = 0;
            idleExemptUntil  = 0;
        }

        // ── Penalty: per calendar day on accIdleFees, after maturity + grace ────
        if (t > maturity && accIdleFees > 0) {
            uint256 penaltyStartDay = MathLib.dayOf(maturity) + penaltyGraceDays;
            uint256 curPenDay = MathLib.dayOf(t);
            uint256 pfrm = lastPenaltyDay > penaltyStartDay ? lastPenaltyDay : penaltyStartDay;
            if (curPenDay > pfrm) {
                uint256 pDays = curPenDay - pfrm;
                accPenalty += MathLib.mulDiv(accIdleFees * pDays, penaltyRateDaily, MathLib.WAD);
                lastPenaltyDay = curPenDay;
            }
        }
    }

    function _accrueExtensionYield() internal {
        if (poolFinalityTs == 0) return;
        if (status == Status.Default) return;

        uint256 t          = block.timestamp;
        uint256 maturityTs = poolFinalityTs;
        if (t <= maturityTs) return;

        uint256 start = lastOverrunTs > maturityTs ? lastOverrunTs : maturityTs;
        if (t <= start) return;

        uint256 deltaSecs = t - start;
        overrunYield += MathLib.mulDiv(
            outstanding * deltaSecs,
            aprAnnual,
            MathLib.WAD * MathLib.SECONDS_PER_YEAR
        );
        lastOverrunTs = t;
    }

    function _globalCheckpoint() internal {
        if (status == Status.Funding) {
            fundingCredit += principal * (block.timestamp - lastUpdate);
            lastUpdate     = block.timestamp;
        }
    }

    function _lpCheckpoint(address lp) internal {
        LPPosition storage pos = lpPositions[lp];
        // Freeze LP accrual at the Unsuccessful transition; global fundingCredit was synced to that horizon.
        uint256 effectiveTs = (status == Status.Unsuccessful && block.timestamp > lastUpdate)
            ? lastUpdate
            : block.timestamp;
        pos.fundingCredit += pos.principal * (effectiveTs - pos.lastUpdate);
        pos.lastUpdate     = effectiveTs;
    }

    function _settleLpDollarSeconds(address lp) internal {
        LPPosition storage pos = lpPositions[lp];
        if (!pos.finalized) {
            if (pos.lastUpdate < poolStartTs) {
                pos.fundingCredit += pos.principal * (poolStartTs - pos.lastUpdate);
                pos.lastUpdate     = poolStartTs;
            }
            pos.finalized = true;
        }
        pos.dollarSeconds = pos.fundingCredit + pos.principal * span;
    }

    // ── Internal: allocation ──────────────────────────────────────────────────

    function _allocate(uint256 amount) internal {
        // block.timestamp vs poolFinalityTs: day-granular design; validator drift is immaterial.
        if (status == Status.Active && block.timestamp < poolFinalityTs) {
            uint256 toYield = yieldOwed > collectedYield ? yieldOwed - collectedYield : 0;
            if (toYield > amount) toYield = amount;
            collectedYield += toYield;
            amount         -= toYield;
            reservedYield  += amount;
        } else {
            uint256 amt = amount + reservedYield;
            reservedYield = 0;
            uint256 toBase = yieldOwed > collectedYield ? yieldOwed - collectedYield : 0;
            if (toBase > amt) toBase = amt;
            collectedYield += toBase;
            amt            -= toBase;
            uint256 toOverrun = overrunYield > collectedOverrunYield ? overrunYield - collectedOverrunYield : 0;
            if (toOverrun > amt) toOverrun = amt;
            collectedOverrunYield += toOverrun;
            amt                   -= toOverrun;
            protocolFees          += amt;
        }
    }

    // ── Internal: maturity + finality ─────────────────────────────────────────

    function _mature() internal {
        if (status != Status.Active) return;
        // block.timestamp drift shifts maturity detection by at most seconds; day-granular design makes this immaterial.
        if (block.timestamp < poolFinalityTs) return;
        collectedPrincipal += availableToDd;
        availableToDd       = 0;
        idleExemptAmount    = 0;
        idleExemptUntil     = 0;
        _checkFinality();
    }

    function _checkFinality() internal {
        if (status == Status.Closed || status == Status.Default) return;
        // block.timestamp drift is immaterial: finality is conditioned on economic settlement, not only time.
        if (block.timestamp < poolFinalityTs) return;
        if (collectedYield     >= yieldOwed &&
            collectedOverrunYield >= overrunYield &&
            collectedPrincipal >= principal &&
            accIdleFees == 0 &&
            accPenalty  == 0)
        {
            status = Status.Closed;
            _settleTerminalSplit();
            emit PoolClosed();
            _releasePsp();
        }
    }

    // Default does not call _releasePsp() — the PSP slot is held until the default resolves
    // to Closed here (all obligations satisfied). An unresolved Default permanently occupies
    // the slot; releasePsp is only called when the pool reaches Closed or Unsuccessful.
    function _resolveDefaultIfWhole() internal {
        if (status != Status.Default) return;
        if (collectedYield     >= yieldOwed &&
            collectedOverrunYield >= overrunYield &&
            collectedPrincipal >= principal)
        {
            status = Status.Closed;
            emit PoolClosed();
            _releasePsp();
        }
    }

    function _settleTerminalSplit() internal {
        // Flush any pre-maturity surplus held in reservedYield into protocolFees.
        // Covers the case where claimYield triggers closure without a prior _allocate
        // call. Safe because _checkFinality (the only caller) requires
        // collectedYield >= yieldOwed AND collectedOverrunYield >= overrunYield
        // (lines 914-915), so both shortfalls are zero — the _allocate waterfall
        // would route 100% of reservedYield to protocolFees anyway.
        protocolFees += reservedYield;
        reservedYield  = 0;

        uint256 residual = protocolFees;
        if (residual == 0) return;

        (uint256 resRate, , uint256 hurdleFrac, uint256 lpBShare) =
            ITreasuryReserve(treasury).riskParams();

        uint256 shortfall = ITreasuryReserve(treasury).reserveShortfallToTarget();
        uint256 topup     = MathLib.mulDiv(residual, resRate, MathLib.WAD);
        if (topup > shortfall) topup = shortfall;

        if (topup > 0) {
            protocolFees -= topup;
            residual     -= topup;
            IERC20(stablecoin).forceApprove(treasury, topup);
            ITreasuryReserve(treasury).topUp(topup);
        }

        uint256 yieldPaid = yieldOwed + overrunYield;
        uint256 hurdle    = MathLib.mulDiv(hurdleFrac, yieldPaid, MathLib.WAD);
        uint256 excess    = residual > hurdle ? residual - hurdle : 0;
        uint256 lpBonus   = MathLib.mulDiv(lpBShare, excess, MathLib.WAD);
        collectedBonus = lpBonus;
        protocolFees   = residual - lpBonus;
    }

    // ── Internal: helpers ────────────────────────────────────────────────────

    function _penaltyStartDay(uint256 dueDayOffset) internal view returns (uint256) {
        uint256 raw = dueDayOffset + 1 + penaltyGraceDays;
        return raw < maxDdDays ? raw : maxDdDays;
    }

    function _hasOverdueUnsettled() internal view returns (bool) {
        if (scOverdueCheck) {
            uint256 nowDay = MathLib.dayOf(block.timestamp);
            for (uint256 i = 0; i < drawDownRefs.length; i++) {
                DrawDown storage dd = drawDowns[drawDownRefs[i]];
                uint256 dueDayOffset = (dd.expiryTs - dd.startTs) / MathLib.SECONDS_PER_DAY;
                if (nowDay - MathLib.dayOf(dd.startTs) >= _penaltyStartDay(dueDayOffset)) {
                    return true;
                }
            }
            return false;
        } else {
            return paused;
        }
    }

    function _removeDrawDown(bytes32 ref) internal {
        uint256 idx = refIndex[ref]; // 1-indexed
        require(idx > 0, "Pool: ref not tracked");
        uint256 lastIdx = drawDownRefs.length;
        if (idx != lastIdx) {
            bytes32 lastRef = drawDownRefs[lastIdx - 1];
            drawDownRefs[idx - 1] = lastRef;
            refIndex[lastRef]     = idx;
        }
        drawDownRefs.pop();
        delete refIndex[ref];
        delete drawDowns[ref];
    }

    function _releasePsp() internal {
        if (_pspReleased) return;
        _pspReleased = true;
        IPoolFactory(factory).releasePsp(pspWallet);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function getRepaymentOwed(bytes32 ref)
        external
        view
        returns (uint256 principalOwed, uint256 financeCharge, uint256 total)
    {
        DrawDown storage dd = drawDowns[ref];
        require(dd.principal > 0, "Pool: no drawdown");

        principalOwed = dd.principal;
        uint256 dueDayOffset = (dd.expiryTs - dd.startTs) / MathLib.SECONDS_PER_DAY;
        uint256 elapsedDays  = MathLib.dayOf(block.timestamp) - MathLib.dayOf(dd.startTs);
        uint256 pStart       = _penaltyStartDay(dueDayOffset);
        uint256 daysTotal    = elapsedDays + 1;
        uint256 stdDays      = daysTotal < pStart ? daysTotal : pStart;
        if (stdDays < minDdDays) stdDays = minDdDays;
        uint256 penDays      = daysTotal > pStart ? daysTotal - pStart : 0;

        financeCharge = MathLib.mulDiv(
            principalOwed,
            stdDays * utilizedRateDaily + penDays * penaltyRateDaily,
            MathLib.WAD
        );
        total = principalOwed + financeCharge;
    }

    function getLpPosition(address lp)
        external
        view
        returns (
            uint256 lpPrincipal,
            uint256 lpDollarSeconds,
            uint256 claimableYield_,
            uint256 claimablePrincipal_,
            uint256 claimableOverrun_,
            uint256 claimableBonus_
        )
    {
        LPPosition storage pos = lpPositions[lp];
        lpPrincipal     = pos.principal;
        lpDollarSeconds = pos.dollarSeconds;

        if (pos.principal > 0) {
            // Delegate to the shared breakdown helper (settlement replication, F1 cap, pool caps).
            // This ensures getLpPosition.claimableYield_ is always bit-identical to
            // getClaimableYieldBreakdown.baseYield — guarding against the two drifting apart.
            (claimableYield_, claimableOverrun_, claimableBonus_) = _computeBreakdown(lp);

            if (principal > 0) {
                uint256 principalOwed = MathLib.mulDiv(pos.principal, collectedPrincipal, principal);
                claimablePrincipal_ = principalOwed > pos.claimedPrincipal
                    ? principalOwed - pos.claimedPrincipal : 0;
            }
        }
    }

    /// @dev Returns the three yield streams claimYield() would transfer, including pool-level caps.
    ///      totalYield == what claimYield() transfers at the same instant.
    ///      Both getLpPosition and getClaimableYieldBreakdown call _computeBreakdown so their
    ///      claimable-yield fields are guaranteed to agree.
    function getClaimableYieldBreakdown(address lp)
        external
        view
        returns (uint256 baseYield, uint256 overrunYield_, uint256 bonus, uint256 totalYield)
    {
        (baseYield, overrunYield_, bonus) = _computeBreakdown(lp);
        totalYield = baseYield + overrunYield_ + bonus;
    }

    /// @dev Shared yield-breakdown computation used by getLpPosition and getClaimableYieldBreakdown.
    ///      Replicates _settleLpDollarSeconds (read-side) and the F1 pre-maturity cap so the
    ///      returned amounts are bit-identical to what claimYield() would transfer at the same T.
    ///      This is the single authoritative implementation; both view callers delegate here to
    ///      prevent the two surfaces drifting under future edits.
    function _computeBreakdown(address lp)
        internal
        view
        returns (uint256 baseYield, uint256 overrunYield_, uint256 bonus)
    {
        if (dollarSeconds == 0 || principal == 0) return (0, 0, 0);
        LPPosition storage pos = lpPositions[lp];
        if (pos.principal == 0) return (0, 0, 0);

        // Read-side replication of _settleLpDollarSeconds: derive effectiveFc the same way
        // settle would (adds pre-poolStart credit when not yet finalized).
        uint256 effectiveFc = pos.fundingCredit;
        if (!pos.finalized && pos.lastUpdate < poolStartTs) {
            effectiveFc += pos.principal * (poolStartTs - pos.lastUpdate);
        }
        uint256 lpDs = effectiveFc + pos.principal * span;
        if (lpDs == 0) return (0, 0, 0);

        uint256 baseShare = MathLib.mulDiv(lpDs, MathLib.WAD, dollarSeconds);

        // F1 cap: mirrors the pre-maturity in-flight cap in claimYield().
        if (status == Status.Active && block.timestamp < poolFinalityTs) {
            uint256 elapsed       = block.timestamp - poolStartTs;
            uint256 dsPoolElapsed = fundingCredit + principal * elapsed;
            if (dsPoolElapsed > 0) {
                uint256 dsLpElapsed  = effectiveFc + pos.principal * elapsed;
                uint256 elapsedShare = MathLib.mulDiv(dsLpElapsed, MathLib.WAD, dsPoolElapsed);
                if (elapsedShare < baseShare) baseShare = elapsedShare;
            }
        }

        uint256 baseOwed    = MathLib.mulDiv(baseShare, collectedYield, MathLib.WAD);
        uint256 overrunOwed = MathLib.mulDiv(pos.principal, collectedOverrunYield, principal);
        uint256 bonusOwed   = MathLib.mulDiv(pos.principal, collectedBonus, principal);

        uint256 claimableBase    = baseOwed    > pos.claimedYield        ? baseOwed    - pos.claimedYield        : 0;
        uint256 claimableOverrun = overrunOwed > pos.claimedOverrunYield ? overrunOwed - pos.claimedOverrunYield : 0;
        uint256 claimableBonus   = bonusOwed   > pos.claimedBonus        ? bonusOwed   - pos.claimedBonus        : 0;

        // Pool-level safety caps — mirrors claimYield().
        uint256 poolYieldLeft   = collectedYield        - claimedYield;
        uint256 poolOverrunLeft = collectedOverrunYield - claimedOverrunYield;
        uint256 poolBonusLeft   = collectedBonus        - claimedBonus;
        if (claimableBase    > poolYieldLeft)   claimableBase    = poolYieldLeft;
        if (claimableOverrun > poolOverrunLeft) claimableOverrun = poolOverrunLeft;
        if (claimableBonus   > poolBonusLeft)   claimableBonus   = poolBonusLeft;

        baseYield    = claimableBase;
        overrunYield_ = claimableOverrun;
        bonus        = claimableBonus;
    }

    /// @dev Returns the day decomposition underlying getRepaymentOwed.
    ///      financeCharge/total match getRepaymentOwed and what repay() charges.
    ///      elapsedDays is Day-0-inclusive (daysTotal = raw_elapsed + 1).
    ///
    ///      The day fields here ARE valid fee-reconstruction inputs: a drawdown has
    ///      a fixed principal throughout its life, so
    ///      financeCharge == principal × (stdDays × utilizedRateDaily + penDays × penaltyRateDaily).
    ///      The idle-fee getter (getIdleFeesBreakdown) deliberately exposes no day fields;
    ///      see its doc comment for the reason.
    function getRepaymentBreakdown(bytes32 ref)
        external
        view
        returns (
            uint256 principalOwed,
            uint256 financeCharge,
            uint256 total,
            uint256 elapsedDays,
            uint256 stdDays,
            uint256 penDays
        )
    {
        DrawDown storage dd = drawDowns[ref];
        require(dd.principal > 0, "Pool: no drawdown");

        principalOwed = dd.principal;
        uint256 dueDayOffset   = (dd.expiryTs - dd.startTs) / MathLib.SECONDS_PER_DAY;
        uint256 rawElapsedDays = MathLib.dayOf(block.timestamp) - MathLib.dayOf(dd.startTs);
        uint256 pStart         = _penaltyStartDay(dueDayOffset);
        uint256 daysTotal      = rawElapsedDays + 1;
        stdDays = daysTotal < pStart ? daysTotal : pStart;
        if (stdDays < minDdDays) stdDays = minDdDays;
        penDays     = daysTotal > pStart ? daysTotal - pStart : 0;
        elapsedDays = daysTotal;

        financeCharge = MathLib.mulDiv(
            principalOwed,
            stdDays * utilizedRateDaily + penDays * penaltyRateDaily,
            MathLib.WAD
        );
        total = principalOwed + financeCharge;
    }

    /// @dev Returns the three idle-fee amounts that payAccruedIdleFees() charges.
    ///      The returned amounts are authoritative and equal what payAccruedIdleFees charges
    ///      at the same instant.
    ///
    ///      Idle-fee duration is intentionally not exposed as a day-count.
    ///      Idle accrual is balance-weighted over a varying availableToDd
    ///      (∫ availableToDd dt × rate), not a fixed principal × duration product.
    ///      No day-count — regardless of anchor — correctly represents "days idle":
    ///      "days since lock" overcounts (counts fully-deployed periods); "days since
    ///      last checkpoint" bounces on unrelated state-changing calls. Any pool-timeline
    ///      display (days since lock, days to maturity) is computed client-side from
    ///      getPoolMetrics timestamps and must NOT be presented as "days idle."
    function getIdleFeesBreakdown()
        external
        view
        returns (
            uint256 idleFees,
            uint256 penaltyOwed,
            uint256 total
        )
    {
        (idleFees, penaltyOwed, total) = _projectIdleFees();
    }

    /// @dev Pure read-side projection of _accrueIdleFees() at the current timestamp.
    ///      Returns exactly what _accrueIdleFees would bank if called now.
    ///      Used by getIdleFeesBreakdown() (view == state gate).
    function _projectIdleFees()
        internal
        view
        returns (uint256 idleFees, uint256 penaltyOwed, uint256 total)
    {
        if (poolFinalityTs == 0 || status == Status.Default) return (0, 0, 0);

        uint256 t        = block.timestamp;
        uint256 maturity = poolFinalityTs;

        uint256 lastBillableDay = MathLib.dayOf(maturity) - 1;
        uint256 startDay        = MathLib.dayOf(poolStartTs);
        uint256 currentDay      = MathLib.dayOf(t);
        if (currentDay > lastBillableDay + 1) currentDay = lastBillableDay + 1;

        uint256 frm = lastIdleDay > startDay ? lastIdleDay : startDay;
        uint256 to  = currentDay;

        idleFees = accIdleFees;

        if (to > frm) {
            uint256 N     = to - frm;
            uint256 avail = availableToDd;
            uint256 rate  = idleRateDaily;

            uint256 nExempt = 0;
            if (idleExemptAmount > 0 && idleExemptUntil > 0) {
                uint256 euDay = MathLib.dayOf(idleExemptUntil);
                if (euDay > frm) {
                    nExempt = euDay > to ? N : euDay - frm;
                }
            }
            uint256 nFull = N - nExempt;

            if (nExempt > 0) {
                uint256 exemptBase = avail > idleExemptAmount ? avail - idleExemptAmount : 0;
                idleFees += MathLib.mulDiv(exemptBase * nExempt, rate, MathLib.WAD);
            }
            if (nFull > 0) {
                idleFees += MathLib.mulDiv(avail * nFull, rate, MathLib.WAD);
            }
        }

        penaltyOwed = accPenalty;
        if (t > maturity && idleFees > 0) {
            uint256 penaltyStartDay = MathLib.dayOf(maturity) + penaltyGraceDays;
            uint256 curPenDay = MathLib.dayOf(t);
            uint256 pfrm = lastPenaltyDay > penaltyStartDay ? lastPenaltyDay : penaltyStartDay;
            if (curPenDay > pfrm) {
                uint256 pDays = curPenDay - pfrm;
                penaltyOwed += MathLib.mulDiv(idleFees * pDays, penaltyRateDaily, MathLib.WAD);
            }
        }

        total = idleFees + penaltyOwed;
    }

    // Gas note: _hasOverdueUnsettled is O(drawDownRefs.length) when scOverdueCheck=true.
    // executeDrawdown calls it; gas scales with live drawdown count.
    // No on-chain cap — operator monitors drawDownRefs.length and trips scOverdueCheck
    // or pause if N grows unexpectedly large.
    //
    // Pool-level gate only: returns true when the pool is not blocked by an overdue unsettled
    // drawdown. This is necessary but not sufficient for any specific drawdown to succeed —
    // executeDrawdown has additional per-call guards (status, receiver, cap, amount, etc.) that
    // surface as reverts. Agents should use this as a quick "is the pool currently open for
    // drawdowns at all" check, not as a guarantee that a specific draw will go through.
    function isDrawdownAllowed() external view returns (bool) {
        return !_hasOverdueUnsettled();
    }

    function currentDay() external view returns (uint256) {
        return MathLib.dayOf(block.timestamp);
    }

    function isAuthorizedReceiver(address receiver) external view returns (bool) {
        return authorizedReceivers[receiver];
    }

    function getDrawDown(bytes32 ref) external view returns (DrawDown memory) {
        return drawDowns[ref];
    }

    function getPoolMetrics()
        external
        view
        returns (
            Status   status_,
            uint256  softCap_,
            uint256  hardCap_,
            uint256  principal_,
            uint256  availableToDd_,
            uint256  outstanding_,
            uint256  yieldOwed_,
            uint256  collectedYield_,
            uint256  collectedPrincipal_,
            bool     paused_,
            bool     scOverdueCheck_,
            uint256  fundingStartTs_,
            uint256  fMaturityTs_,
            uint256  poolStartTs_,
            uint256  poolFinalityTs_
        )
    {
        return (
            status, softCap, hardCap, principal, availableToDd, outstanding,
            yieldOwed, collectedYield, collectedPrincipal, paused, scOverdueCheck,
            fundingStartTs, fMaturityTs, poolStartTs, poolFinalityTs
        );
    }
}
