// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "./PoolContract.sol";
import "./MathLib.sol";

contract PoolFactory is AccessControl {
    using Clones for address;

    // ── Roles ────────────────────────────────────────────────────────────────

    bytes32 public constant DEPLOYER_ROLE  = keccak256("DEPLOYER_ROLE");
    bytes32 public constant MULTISIG_ROLE_ = keccak256("MULTISIG_ROLE");

    // ── PSP registry ─────────────────────────────────────────────────────────

    struct PspRecord {
        bool    approved;
        address activePool;
    }
    mapping(address => PspRecord) public psps;

    // ── Pool registry ─────────────────────────────────────────────────────────

    address[]                    public pools;
    mapping(address => bool)     public isPoolExist;
    uint256                      public poolCount;

    // ── Economic envelope (multisig-settable) ─────────────────────────────────

    struct Envelope {
        uint256 minApr;        // WAD
        uint256 maxApr;        // WAD
        uint256 minTenure;
        uint256 maxTenure;
        uint256 minPgd;
        uint256 maxPgd;
        uint256 minIdleRate;   // WAD
        uint256 maxIdleRate;   // WAD
        uint256 minUtilRate;   // WAD
        uint256 maxUtilRate;   // WAD
        uint256 minPenRate;    // WAD
        uint256 maxPenRate;    // WAD
        uint256 hardCapCeiling;
    }
    Envelope public envelope;

    // ── Global bound defaults (multisig-settable; stamped into clones) ────────

    uint256 public maxFundingDurationSecs; // protocol ceiling on any pool's funding window (30 days = 2_592_000 s)
    uint256 public fundingExecBufferDays; // WAD fraction of a day (e.g. 0.25*WAD)
    uint256 public maxGracePeriodDays;
    uint256 public minDdDays;
    uint256 public maxDdDays;

    // ── Fixed addresses ───────────────────────────────────────────────────────

    address public poolImplementation;
    address public treasury;
    address public stablecoin;

    // ── Events ───────────────────────────────────────────────────────────────

    event PoolCreated(address indexed pool, uint256 indexed poolId, address indexed psp, address pspWallet, uint256 fMaturityTs);
    event PspApproved(address indexed psp);
    event PspRevoked(address indexed psp);
    event PspWalletReassigned(address indexed oldPsp, address indexed newPsp);
    event PspReleased(address indexed psp);
    event EnvelopeUpdated(
        uint256 minApr,
        uint256 maxApr,
        uint256 minTenure,
        uint256 maxTenure,
        uint256 minPgd,
        uint256 maxPgd,
        uint256 minIdleRate,
        uint256 maxIdleRate,
        uint256 minUtilRate,
        uint256 maxUtilRate,
        uint256 minPenRate,
        uint256 maxPenRate,
        uint256 hardCapCeiling
    );
    event BoundsUpdated(
        uint256 maxFundingDurationSecs,
        uint256 fundingExecBufferDays,
        uint256 maxGracePeriodDays,
        uint256 minDdDays,
        uint256 maxDdDays
    );

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(
        address multisig,
        address deployer,
        address _poolImplementation,
        address _treasury,
        address _stablecoin,
        uint256 _maxFundingDurationSecs,
        uint256 _fundingExecBufferDays,
        uint256 _maxGracePeriodDays,
        uint256 _minDdDays,
        uint256 _maxDdDays
    ) {
        require(multisig != address(0), "Factory: zero multisig");
        require(_poolImplementation != address(0), "Factory: zero impl");
        require(_treasury != address(0), "Factory: zero treasury");
        require(_stablecoin != address(0), "Factory: zero stablecoin");

        _grantRole(DEFAULT_ADMIN_ROLE, multisig);
        _grantRole(MULTISIG_ROLE_, multisig);
        _grantRole(DEPLOYER_ROLE,  deployer);

        poolImplementation       = _poolImplementation;
        treasury                 = _treasury;
        stablecoin               = _stablecoin;
        maxFundingDurationSecs   = _maxFundingDurationSecs;
        fundingExecBufferDays    = _fundingExecBufferDays;
        maxGracePeriodDays    = _maxGracePeriodDays;
        minDdDays             = _minDdDays;
        maxDdDays             = _maxDdDays;

        // Default permissive envelope (operator must set a proper one)
        envelope = Envelope({
            minApr:        0,
            maxApr:        type(uint256).max,
            minTenure:     1,
            maxTenure:     type(uint256).max,
            minPgd:        0,
            maxPgd:        _maxGracePeriodDays,
            minIdleRate:   0,
            maxIdleRate:   type(uint256).max,
            minUtilRate:   0,
            maxUtilRate:   type(uint256).max,
            minPenRate:    0,
            maxPenRate:    type(uint256).max,
            hardCapCeiling: type(uint256).max
        });
    }

    // ── PSP management ────────────────────────────────────────────────────────

    function approvePsp(address psp) external onlyRole(MULTISIG_ROLE_) {
        require(psp != address(0), "Factory: zero psp");
        psps[psp].approved = true;
        emit PspApproved(psp);
    }

    function revokePsp(address psp) external onlyRole(MULTISIG_ROLE_) {
        psps[psp].approved = false;
        emit PspRevoked(psp);
    }

    function reassignPspWallet(address oldPsp, address newPsp) external onlyRole(MULTISIG_ROLE_) {
        require(newPsp != address(0), "Factory: zero new psp");
        PspRecord storage rec = psps[oldPsp];
        require(rec.approved, "Factory: old psp not approved");
        require(psps[newPsp].activePool == address(0), "Factory: new psp has live pool");
        // Cache activePool before delete: the storage ref rec becomes zero after delete psps[oldPsp].
        address activePool = rec.activePool;
        psps[newPsp] = PspRecord({ approved: true, activePool: activePool });
        delete psps[oldPsp];
        if (activePool != address(0)) {
            PoolContract(activePool).setPspWallet(newPsp);
        }
        emit PspWalletReassigned(oldPsp, newPsp);
    }

    // ── PSP slot release (called by pool on terminal state) ───────────────────
    // Called by pools on Closed and Unsuccessful. NOT called on Default — a defaulted pool
    // permanently holds its PSP's slot until the default resolves to Closed via
    // settleDefaultPrincipal/settleDefaultYield making the pool whole. This is deliberate:
    // defaulted PSPs are not re-onboarded while the obligation is unresolved.
    function releasePsp(address psp) external {
        PspRecord storage rec = psps[psp];
        require(msg.sender == rec.activePool, "Factory: not slot holder");
        rec.activePool = address(0);
        emit PspReleased(psp);
    }

    // ── Pool creation ─────────────────────────────────────────────────────────

    struct CreatePoolParams {
        address pspWallet;
        uint256 fundingDurationSecs; // per-pool funding window in seconds; must be > 0 and <= maxFundingDurationSecs
        uint256 softCap;
        uint256 hardCap;
        uint256 tenure;
        uint256 idleRateDaily;     // WAD
        uint256 utilizedRateDaily; // WAD
        uint256 penaltyRateDaily;  // WAD
        uint256 penaltyGraceDays;
        uint256 minDeposit;
        uint256 aprAnnual;         // WAD
        address agent1;
        address agent2;
        address multisig;
    }

    function createPool(CreatePoolParams calldata p) external onlyRole(DEPLOYER_ROLE) returns (address pool) {
        // ─── Structural invariants (always on) ──────────────────────────────
        require(p.fundingDurationSecs > 0 && p.fundingDurationSecs <= maxFundingDurationSecs, "Factory: bad fundingDuration");
        require(p.softCap > 0 && p.hardCap >= p.softCap, "Factory: cap invalid");
        require(p.tenure > 0, "Factory: zero tenure");
        require(p.idleRateDaily <= p.utilizedRateDaily, "Factory: idle > util");
        require(p.utilizedRateDaily < p.penaltyRateDaily, "Factory: util >= pen");
        require(p.penaltyGraceDays <= maxGracePeriodDays, "Factory: grace exceeds max");

        // APR coverable by utilized rate: real_tenure_apr <= utilized_rate * 365
        // real_tenure_apr = apr_annual * (maxTenureSecs / (tenure * D))
        // maxTenureSecs includes the midnight snap (up to one full day extension).
        // SYNC: formula must stay identical to PoolContract.initialize() maxTenureSecs assignment.
        uint256 fMaturityRaw_ = block.timestamp + p.fundingDurationSecs;
        uint256 fRemainder_   = fMaturityRaw_ % MathLib.SECONDS_PER_DAY;
        uint256 snapSecs_     = fRemainder_ == 0 ? 0 : MathLib.SECONDS_PER_DAY - fRemainder_;
        uint256 maxTenureSecs = p.fundingDurationSecs
            + snapSecs_
            + MathLib.mulDiv(fundingExecBufferDays, MathLib.SECONDS_PER_DAY, MathLib.WAD)
            + p.tenure * MathLib.SECONDS_PER_DAY
            + p.penaltyGraceDays * MathLib.SECONDS_PER_DAY;
        // Check: aprAnnual * maxTenureSecs <= utilizedRateDaily * 365 * tenure * SECONDS_PER_DAY
        // Both sides WAD-scaled; multiply across to avoid division.
        require(
            p.aprAnnual * maxTenureSecs <= p.utilizedRateDaily * 365 * p.tenure * MathLib.SECONDS_PER_DAY,
            "Factory: APR not coverable by util rate"
        );

        // ─── Economic envelope (multisig-tunable) ────────────────────────────
        require(p.aprAnnual         >= envelope.minApr         && p.aprAnnual         <= envelope.maxApr,         "Factory: APR out of envelope");
        require(p.tenure            >= envelope.minTenure      && p.tenure            <= envelope.maxTenure,      "Factory: tenure out of envelope");
        require(p.penaltyGraceDays  >= envelope.minPgd         && p.penaltyGraceDays  <= envelope.maxPgd,         "Factory: pgd out of envelope");
        require(p.idleRateDaily     >= envelope.minIdleRate    && p.idleRateDaily     <= envelope.maxIdleRate,    "Factory: idle rate out of envelope");
        require(p.utilizedRateDaily >= envelope.minUtilRate    && p.utilizedRateDaily <= envelope.maxUtilRate,    "Factory: util rate out of envelope");
        require(p.penaltyRateDaily  >= envelope.minPenRate     && p.penaltyRateDaily  <= envelope.maxPenRate,     "Factory: pen rate out of envelope");
        require(p.hardCap           <= envelope.hardCapCeiling,                                                   "Factory: hard cap exceeds ceiling");

        // ─── PSP gate ────────────────────────────────────────────────────────
        require(psps[p.pspWallet].approved,              "Factory: PSP not approved");
        require(psps[p.pspWallet].activePool == address(0), "Factory: PSP has live pool");

        // ─── Deploy clone + initialize ───────────────────────────────────────
        pool = poolImplementation.clone();

        PoolContract.InitParams memory init = PoolContract.InitParams({
            pspWallet:            p.pspWallet,
            softCap:              p.softCap,
            hardCap:              p.hardCap,
            tenure:               p.tenure,
            idleRateDaily:        p.idleRateDaily,
            utilizedRateDaily:    p.utilizedRateDaily,
            penaltyRateDaily:     p.penaltyRateDaily,
            penaltyGraceDays:     p.penaltyGraceDays,
            minDeposit:           p.minDeposit,
            aprAnnual:            p.aprAnnual,
            fundingDurationSecs:  p.fundingDurationSecs,
            fundingExecBufferDays: fundingExecBufferDays,
            maxGracePeriodDays:   maxGracePeriodDays,
            minDdDays:            minDdDays,
            maxDdDays:            maxDdDays,
            treasury:             treasury,
            stablecoin:           stablecoin,
            agent1:               p.agent1,
            agent2:               p.agent2,
            multisig:             p.multisig
        });

        PoolContract(pool).initialize(init);

        // ─── Register ────────────────────────────────────────────────────────
        pools.push(pool);
        isPoolExist[pool] = true;
        poolCount++;
        psps[p.pspWallet].activePool = pool;

        emit PoolCreated(pool, poolCount, p.pspWallet, p.pspWallet, fMaturityRaw_ + snapSecs_);
    }

    // ── Envelope / bounds setters ─────────────────────────────────────────────

    function setEnvelope(Envelope calldata e) external onlyRole(MULTISIG_ROLE_) {
        envelope = e;
        emit EnvelopeUpdated(
            e.minApr, e.maxApr,
            e.minTenure, e.maxTenure,
            e.minPgd, e.maxPgd,
            e.minIdleRate, e.maxIdleRate,
            e.minUtilRate, e.maxUtilRate,
            e.minPenRate, e.maxPenRate,
            e.hardCapCeiling
        );
    }

    function setBounds(
        uint256 _maxFundingDurationSecs,
        uint256 _fundingExecBufferDays,
        uint256 _maxGracePeriodDays,
        uint256 _minDdDays,
        uint256 _maxDdDays
    ) external onlyRole(MULTISIG_ROLE_) {
        maxFundingDurationSecs = _maxFundingDurationSecs;
        fundingExecBufferDays  = _fundingExecBufferDays;
        maxGracePeriodDays     = _maxGracePeriodDays;
        minDdDays              = _minDdDays;
        maxDdDays              = _maxDdDays;
        emit BoundsUpdated(
            _maxFundingDurationSecs, _fundingExecBufferDays, _maxGracePeriodDays,
            _minDdDays, _maxDdDays
        );
    }
}
