/**
 * Minimal human-readable ABIs for the payfi_v1 contract surface the server
 * needs to touch. Kept as strings (ethers.Interface parses them cheaply) so
 * we don't have to run `forge build` + copy JSON just to serve a request.
 *
 * If the contracts change (function signatures, event names, tuple shapes),
 * update the arrays below to match. ethers will throw at Interface parse
 * time if the syntax is wrong.
 */

// ── PoolFactory ────────────────────────────────────────────────────────
const PoolFactoryAbi = [
  // ── reads ─────────────────────────────────────
  'function poolCount() external view returns (uint256)',
  'function pools(uint256) external view returns (address)',
  'function isPoolExist(address) external view returns (bool)',
  'function psps(address) external view returns (bool approved, address activePool)',
  'function poolImplementation() external view returns (address)',
  'function treasury() external view returns (address)',
  'function stablecoin() external view returns (address)',
  'function maxFundingDurationSecs() external view returns (uint256)',
  'function fundingExecBufferDays() external view returns (uint256)',
  'function maxGracePeriodDays() external view returns (uint256)',
  'function minDdDays() external view returns (uint256)',
  'function maxDdDays() external view returns (uint256)',
  'function envelope() external view returns (uint256 minApr,uint256 maxApr,uint256 minTenure,uint256 maxTenure,uint256 minPgd,uint256 maxPgd,uint256 minIdleRate,uint256 maxIdleRate,uint256 minUtilRate,uint256 maxUtilRate,uint256 minPenRate,uint256 maxPenRate,uint256 hardCapCeiling)',

  // ── writes ────────────────────────────────────
  'function approvePsp(address psp) external',
  'function revokePsp(address psp) external',
  'function reassignPspWallet(address oldPsp, address newPsp) external',
  'function createPool(tuple(address pspWallet,uint256 fundingDurationSecs,uint256 softCap,uint256 hardCap,uint256 tenure,uint256 idleRateDaily,uint256 utilizedRateDaily,uint256 penaltyRateDaily,uint256 penaltyGraceDays,uint256 minDeposit,uint256 aprAnnual,address agent1,address agent2,address multisig)) external returns (address pool)',
  'function setEnvelope(tuple(uint256 minApr,uint256 maxApr,uint256 minTenure,uint256 maxTenure,uint256 minPgd,uint256 maxPgd,uint256 minIdleRate,uint256 maxIdleRate,uint256 minUtilRate,uint256 maxUtilRate,uint256 minPenRate,uint256 maxPenRate,uint256 hardCapCeiling)) external',
  'function setBounds(uint256 _maxFundingDurationSecs,uint256 _fundingExecBufferDays,uint256 _maxGracePeriodDays,uint256 _minDdDays,uint256 _maxDdDays) external',

  // ── events ────────────────────────────────────
  'event PoolCreated(address indexed pool, uint256 indexed poolId, address indexed psp, address pspWallet, uint256 fMaturityTs)',
  'event PspApproved(address indexed psp)',
  'event PspRevoked(address indexed psp)',
  'event PspWalletReassigned(address indexed oldPsp, address indexed newPsp)',
  'event PspReleased(address indexed psp)',
];

// ── PoolContract (per-facility) ────────────────────────────────────────
const PoolContractAbi = [
  // ── reads: config ─────────────────────────────
  'function pspWallet() external view returns (address)',
  'function stablecoin() external view returns (address)',
  'function treasury() external view returns (address)',
  'function factory() external view returns (address)',
  'function status() external view returns (uint8)',
  'function softCap() external view returns (uint256)',
  'function hardCap() external view returns (uint256)',
  'function tenure() external view returns (uint256)',
  'function aprAnnual() external view returns (uint256)',
  'function idleRateDaily() external view returns (uint256)',
  'function utilizedRateDaily() external view returns (uint256)',
  'function penaltyRateDaily() external view returns (uint256)',
  'function penaltyGraceDays() external view returns (uint256)',
  'function minDeposit() external view returns (uint256)',
  'function maxTenureSecs() external view returns (uint256)',
  'function fundingDurationSecs() external view returns (uint256)',
  'function fundingExecBufferDays() external view returns (uint256)',

  // ── reads: lifecycle timestamps ───────────────
  'function fundingStartTs() external view returns (uint256)',
  'function fMaturityTs() external view returns (uint256)',
  'function poolStartTs() external view returns (uint256)',
  'function poolFinalityTs() external view returns (uint256)',
  'function lastUpdate() external view returns (uint256)',
  'function span() external view returns (uint256)',

  // ── reads: economics ──────────────────────────
  'function principal() external view returns (uint256)',
  'function availableToDd() external view returns (uint256)',
  'function outstanding() external view returns (uint256)',
  'function fundingCredit() external view returns (uint256)',
  'function dollarSeconds() external view returns (uint256)',
  'function yieldOwed() external view returns (uint256)',

  // ── reads: derived / view getters ─────────────
  'function isDrawdownAllowed() external view returns (bool)',
  'function currentDay() external view returns (uint256)',
  'function isAuthorizedReceiver(address) external view returns (bool)',
  'function getDrawDown(bytes32) external view returns (tuple(uint256 principal,uint256 startTs,uint256 expiryTs,address receiverWallet))',
  'function getRepaymentOwed(bytes32) external view returns (uint256)',
  'function getLpPosition(address) external view returns (uint256 principal,uint256 fundingCredit,uint256 lastUpdate,uint256 dollarSeconds,uint256 claimedYield,uint256 claimedPrincipal,uint256 claimedOverrunYield,uint256 claimedBonus,bool finalized)',
  'function getClaimableYieldBreakdown(address) external view returns (uint256,uint256,uint256)',
  'function getRepaymentBreakdown(bytes32) external view returns (uint256,uint256,uint256)',
  'function getIdleFeesBreakdown() external view returns (uint256,uint256)',
  'function getPoolMetrics() external view returns (uint256,uint256,uint256,uint256,uint256)',

  // ── writes ────────────────────────────────────
  'function initialize(tuple(address pspWallet,uint256 softCap,uint256 hardCap,uint256 tenure,uint256 idleRateDaily,uint256 utilizedRateDaily,uint256 penaltyRateDaily,uint256 penaltyGraceDays,uint256 minDeposit,uint256 aprAnnual,uint256 fundingDurationSecs,uint256 fundingExecBufferDays,uint256 maxGracePeriodDays,uint256 minDdDays,uint256 maxDdDays,address treasury,address stablecoin,address agent1,address agent2,address multisig)) external',
  'function deposit(uint256 amount) external',
  'function withdraw(uint256 amount) external',
  'function finalizeFunding() external',
  'function executeDrawdown(bytes32 ref,address receiverWallet,uint256 amount,uint256 settlementDays) external',
  'function repay(bytes32 ref) external',
  'function payAccruedIdleFees(uint256 amount) external',
  'function claimYield() external',
  'function claimPrincipal() external',
  'function declareDefault() external',
  'function settleDefaultPrincipal(uint256 amount) external',
  'function settleDefaultYield(uint256 amount) external',
  'function sweepProtocolFees() external',
  'function setPspWallet(address newWallet) external',
  'function setScOverdue(bool enabled) external',
  'function setPaused(bool _paused) external',
  'function addReceiver(address receiverWallet) external',
  'function removeReceiver(address receiverWallet) external',

  // ── events ────────────────────────────────────
  'event Deposit(address indexed lp, uint256 amount)',
  'event Withdraw(address indexed lp, uint256 amount)',
  'event Locked(uint256 t, uint256 poolFinalityTs, uint256 dollarSeconds, uint256 yieldOwed)',
  'event FundingFailed()',
  'event DrawdownExecuted(bytes32 indexed ref, address indexed receiverWallet, uint256 principal, uint256 expiryTs)',
  'event Repaid(bytes32 indexed ref, uint256 principalPaid, uint256 utilFeePaid, uint256 penaltyPaid)',
  'event YieldClaimed(address indexed lp, uint256 amount)',
  'event PrincipalClaimed(address indexed lp, uint256 amount)',
  'event DefaultDeclared()',
  'event DefaultSettledPrincipal(uint256 paid, uint256 fromDirect, uint256 fromReserve)',
  'event DefaultSettledYield(uint256 paid, uint256 fromDirect, uint256 fromReserve)',
  'event PoolClosed()',
  'event ProtocolFeesSwept(uint256 amount)',
  'event ReceiverAdded(address indexed receiver)',
  'event ReceiverRemoved(address indexed receiver)',
  'event PspWalletUpdated(address newWallet)',
  'event PoolPaused(bool paused)',
  'event ScOverdueSet(bool enabled)',
];

// ── TreasuryReserve ────────────────────────────────────────────────────
const TreasuryReserveAbi = [
  'function factory() external view returns (address)',
  'function targetReserve() external view returns (uint256)',
  'function reserveShortfallToTarget() external view returns (uint256)',
  'function stablecoin() external view returns (address)',
  'function setFactory(address _factory) external',
  'function withdrawReserve(address to, uint256 amount) external',
  'function withdrawImFees(address to, uint256 amount) external',
  'function drawReserve(uint256 amount) external returns (uint256 drawn)',
  'function topUp(uint256 amount) external',
  'function depositImFees(uint256 amount) external',
];

// ── ERC20 (used for MockStablecoin + real USDC) ────────────────────────
const ERC20Abi = [
  'function name() external view returns (string)',
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
  'function totalSupply() external view returns (uint256)',
  'function balanceOf(address) external view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) external returns (bool)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  // MockStablecoin adds a permissioned mint. Real USDC won't have this,
  // so the /faucet route will only work on testnet with MockStablecoin.
  'function mint(address to, uint256 amount) external',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
];

module.exports = {
  PoolFactoryAbi,
  PoolContractAbi,
  TreasuryReserveAbi,
  ERC20Abi,
};
