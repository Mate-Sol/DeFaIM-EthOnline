import { BigInt, Bytes, Address, ethereum } from "@graphprotocol/graph-ts";
import {
  Deposit as DepositEvent,
  Withdraw as WithdrawEvent,
  DrawdownExecuted,
  Repaid,
  YieldClaimed,
  PrincipalClaimed,
  Locked,
  FundingFailed,
  PoolClosed,
  DefaultDeclared,
} from "../generated/templates/Pool/PoolContract";
import {
  Protocol,
  Facility,
  Lender,
  Position,
  Deposit,
  Withdrawal,
  Drawdown,
  Repayment,
  YieldClaim,
  PrincipalClaim,
} from "../generated/schema";

const PROTOCOL_ID = "defa";

// ── helpers ─────────────────────────────────────────────────────────────────

function eventId(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
}

function facilityOf(event: ethereum.Event): Facility | null {
  return Facility.load(event.address.toHexString());
}

function loadLender(addr: Address, timestamp: BigInt): Lender {
  let l = Lender.load(addr.toHexString());
  if (l == null) {
    l = new Lender(addr.toHexString());
    l.firstSeenAt = timestamp;
    l.totalDeposited = BigInt.zero();
    l.totalWithdrawn = BigInt.zero();
    l.totalYieldClaimed = BigInt.zero();
    l.totalPrincipalClaimed = BigInt.zero();
    l.save();
  }
  return l as Lender;
}

// Returns the position and whether it was created, so the caller can keep the
// facility's lender count accurate without a second lookup.
class PositionResult {
  position: Position;
  created: boolean;
  constructor(position: Position, created: boolean) {
    this.position = position;
    this.created = created;
  }
}

function loadPosition(facility: Facility, lender: Lender, timestamp: BigInt): PositionResult {
  const id = facility.id + "-" + lender.id;
  let p = Position.load(id);
  if (p != null) return new PositionResult(p as Position, false);

  p = new Position(id);
  p.facility = facility.id;
  p.lender = lender.id;
  p.shares = BigInt.zero();
  p.deposited = BigInt.zero();
  p.withdrawn = BigInt.zero();
  p.yieldClaimed = BigInt.zero();
  p.principalClaimed = BigInt.zero();
  p.updatedAt = timestamp;
  return new PositionResult(p as Position, true);
}

function bumpProtocol(
  deposited: BigInt, drawn: BigInt, repaid: BigInt, yieldClaimed: BigInt
): void {
  const p = Protocol.load(PROTOCOL_ID);
  if (p == null) return;
  p.totalDeposited = p.totalDeposited.plus(deposited);
  p.totalDrawn = p.totalDrawn.plus(drawn);
  p.totalRepaid = p.totalRepaid.plus(repaid);
  p.totalYieldClaimed = p.totalYieldClaimed.plus(yieldClaimed);
  p.save();
}

// ── ERC-4626 vault events ───────────────────────────────────────────────────

export function handleDeposit(event: DepositEvent): void {
  const f = facilityOf(event);
  if (f == null) return;

  // Shares are credited to `owner`, which is who holds the position.
  const lender = loadLender(event.params.owner, event.block.timestamp);
  const res = loadPosition(f as Facility, lender, event.block.timestamp);
  const pos = res.position;

  const assets = event.params.assets;
  const shares = event.params.shares;

  pos.shares = pos.shares.plus(shares);
  pos.deposited = pos.deposited.plus(assets);
  pos.updatedAt = event.block.timestamp;
  pos.save();

  lender.totalDeposited = lender.totalDeposited.plus(assets);
  lender.save();

  f.totalAssets = f.totalAssets.plus(assets);
  f.totalSupply = f.totalSupply.plus(shares);
  if (res.created) f.lenderCount = f.lenderCount + 1;
  f.save();

  const d = new Deposit(eventId(event));
  d.facility = f.id;
  d.lender = lender.id;
  d.sender = event.params.sender;
  d.owner = event.params.owner;
  d.assets = assets;
  d.shares = shares;
  d.timestamp = event.block.timestamp;
  d.block = event.block.number;
  d.txHash = event.transaction.hash;
  d.save();

  bumpProtocol(assets, BigInt.zero(), BigInt.zero(), BigInt.zero());
}

export function handleWithdraw(event: WithdrawEvent): void {
  const f = facilityOf(event);
  if (f == null) return;

  const lender = loadLender(event.params.owner, event.block.timestamp);
  const pos = loadPosition(f as Facility, lender, event.block.timestamp).position;

  const assets = event.params.assets;
  const shares = event.params.shares;

  pos.shares = pos.shares.minus(shares);
  pos.withdrawn = pos.withdrawn.plus(assets);
  pos.updatedAt = event.block.timestamp;
  pos.save();

  lender.totalWithdrawn = lender.totalWithdrawn.plus(assets);
  lender.save();

  f.totalAssets = f.totalAssets.minus(assets);
  f.totalSupply = f.totalSupply.minus(shares);
  f.save();

  const w = new Withdrawal(eventId(event));
  w.facility = f.id;
  w.lender = lender.id;
  w.sender = event.params.sender;
  w.receiver = event.params.receiver;
  w.owner = event.params.owner;
  w.assets = assets;
  w.shares = shares;
  w.timestamp = event.block.timestamp;
  w.block = event.block.number;
  w.txHash = event.transaction.hash;
  w.save();
}

// ── credit lifecycle ────────────────────────────────────────────────────────

export function handleDrawdownExecuted(event: DrawdownExecuted): void {
  const f = facilityOf(event);
  if (f == null) return;

  const d = new Drawdown(f.id + "-" + event.params.ref.toHexString());
  d.facility = f.id;
  d.ref = event.params.ref;
  d.receiver = event.params.receiver;
  d.amount = event.params.amount;
  d.drawnAt = event.block.timestamp;
  d.block = event.block.number;
  d.txHash = event.transaction.hash;
  d.repaid = false;
  d.save();

  f.totalDrawn = f.totalDrawn.plus(event.params.amount);
  f.outstanding = f.outstanding.plus(event.params.amount);
  f.drawdownCount = f.drawdownCount + 1;
  f.save();

  bumpProtocol(BigInt.zero(), event.params.amount, BigInt.zero(), BigInt.zero());
}

export function handleRepaid(event: Repaid): void {
  const f = facilityOf(event);
  if (f == null) return;

  const drawdownId = f.id + "-" + event.params.ref.toHexString();
  const d = Drawdown.load(drawdownId);

  const principal = event.params.principal;
  const charge = event.params.financeCharge;

  if (d != null) {
    d.repaid = true;
    d.repaidAt = event.block.timestamp;
    d.principalRepaid = principal;
    d.financeCharge = charge;
    d.save();
  }

  const r = new Repayment(eventId(event));
  r.facility = f.id;
  r.drawdown = drawdownId;
  r.ref = event.params.ref;
  r.principal = principal;
  r.financeCharge = charge;
  r.timestamp = event.block.timestamp;
  r.block = event.block.number;
  r.txHash = event.transaction.hash;
  r.save();

  f.totalRepaid = f.totalRepaid.plus(principal);
  f.totalFinanceCharge = f.totalFinanceCharge.plus(charge);
  f.outstanding = f.outstanding.minus(principal);
  f.save();

  bumpProtocol(BigInt.zero(), BigInt.zero(), principal, BigInt.zero());
}

export function handleYieldClaimed(event: YieldClaimed): void {
  const f = facilityOf(event);
  if (f == null) return;

  const lender = loadLender(event.params.lp, event.block.timestamp);
  const pos = loadPosition(f as Facility, lender, event.block.timestamp).position;
  pos.yieldClaimed = pos.yieldClaimed.plus(event.params.amount);
  pos.updatedAt = event.block.timestamp;
  pos.save();

  lender.totalYieldClaimed = lender.totalYieldClaimed.plus(event.params.amount);
  lender.save();

  f.totalYieldClaimed = f.totalYieldClaimed.plus(event.params.amount);
  f.save();

  const c = new YieldClaim(eventId(event));
  c.facility = f.id;
  c.lender = lender.id;
  c.amount = event.params.amount;
  c.timestamp = event.block.timestamp;
  c.block = event.block.number;
  c.txHash = event.transaction.hash;
  c.save();

  bumpProtocol(BigInt.zero(), BigInt.zero(), BigInt.zero(), event.params.amount);
}

export function handlePrincipalClaimed(event: PrincipalClaimed): void {
  const f = facilityOf(event);
  if (f == null) return;

  const lender = loadLender(event.params.lp, event.block.timestamp);
  const pos = loadPosition(f as Facility, lender, event.block.timestamp).position;
  pos.principalClaimed = pos.principalClaimed.plus(event.params.amount);
  pos.updatedAt = event.block.timestamp;
  pos.save();

  lender.totalPrincipalClaimed = lender.totalPrincipalClaimed.plus(event.params.amount);
  lender.save();

  f.totalPrincipalClaimed = f.totalPrincipalClaimed.plus(event.params.amount);
  f.save();

  const c = new PrincipalClaim(eventId(event));
  c.facility = f.id;
  c.lender = lender.id;
  c.amount = event.params.amount;
  c.timestamp = event.block.timestamp;
  c.block = event.block.number;
  c.txHash = event.transaction.hash;
  c.save();
}

// ── status transitions ──────────────────────────────────────────────────────

export function handleLocked(event: Locked): void {
  const f = facilityOf(event);
  if (f == null) return;
  f.status = "ACTIVE";
  f.lockedAt = event.params.poolStartTs;
  f.finalityAt = event.params.poolFinalityTs;
  f.save();
}

export function handleFundingFailed(event: FundingFailed): void {
  const f = facilityOf(event);
  if (f == null) return;
  f.status = "UNSUCCESSFUL";
  f.save();
}

export function handlePoolClosed(event: PoolClosed): void {
  const f = facilityOf(event);
  if (f == null) return;
  f.status = "CLOSED";
  f.save();
}

export function handleDefaultDeclared(event: DefaultDeclared): void {
  const f = facilityOf(event);
  if (f == null) return;
  f.status = "DEFAULTED";
  f.save();
}
