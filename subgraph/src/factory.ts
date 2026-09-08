import { BigInt, Address } from "@graphprotocol/graph-ts";
import { PoolCreated } from "../generated/PoolFactory/PoolFactory";
import { PoolContract } from "../generated/PoolFactory/PoolContract";
import { Protocol, Facility } from "../generated/schema";
import { Pool } from "../generated/templates";

const PROTOCOL_ID = "defa";

export function loadProtocol(factory: Address, asset: Address): Protocol {
  let p = Protocol.load(PROTOCOL_ID);
  if (p == null) {
    p = new Protocol(PROTOCOL_ID);
    p.factory = factory;
    p.asset = asset;
    p.facilityCount = 0;
    p.totalDeposited = BigInt.zero();
    p.totalDrawn = BigInt.zero();
    p.totalRepaid = BigInt.zero();
    p.totalYieldClaimed = BigInt.zero();
  }
  return p as Protocol;
}

export function handlePoolCreated(event: PoolCreated): void {
  const pool = event.params.pool;

  // Terms are stamped into the clone at initialize and never change, so they
  // are read once here rather than on every subsequent event.
  const c = PoolContract.bind(pool);

  const asset = c.try_stablecoin();
  const protocol = loadProtocol(
    event.address,
    asset.reverted ? Address.zero() : asset.value
  );

  const f = new Facility(pool.toHexString());
  f.protocol = protocol.id;
  f.poolId = event.params.poolId;
  f.borrower = event.params.psp;
  f.createdAt = event.block.timestamp;
  f.createdAtBlock = event.block.number;

  f.asset = asset.reverted ? Address.zero() : asset.value;
  f.totalAssets = BigInt.zero();
  f.totalSupply = BigInt.zero();

  f.status = "FUNDING";
  f.fundingMaturity = event.params.fMaturityTs;

  // try_ everywhere: a getter that reverts must not halt indexing.
  const softCap = c.try_softCap();
  f.softCap = softCap.reverted ? BigInt.zero() : softCap.value;
  const hardCap = c.try_hardCap();
  f.hardCap = hardCap.reverted ? BigInt.zero() : hardCap.value;
  const tenure = c.try_tenure();
  f.tenureDays = tenure.reverted ? BigInt.zero() : tenure.value;
  const apr = c.try_aprAnnual();
  f.aprAnnual = apr.reverted ? BigInt.zero() : apr.value;
  const util = c.try_utilizedRateDaily();
  f.utilizedRateDaily = util.reverted ? BigInt.zero() : util.value;
  const idle = c.try_idleRateDaily();
  f.idleRateDaily = idle.reverted ? BigInt.zero() : idle.value;
  const pen = c.try_penaltyRateDaily();
  f.penaltyRateDaily = pen.reverted ? BigInt.zero() : pen.value;
  const pgd = c.try_penaltyGraceDays();
  f.penaltyGraceDays = pgd.reverted ? BigInt.zero() : pgd.value;

  f.totalDrawn = BigInt.zero();
  f.totalRepaid = BigInt.zero();
  f.totalFinanceCharge = BigInt.zero();
  f.totalYieldClaimed = BigInt.zero();
  f.totalPrincipalClaimed = BigInt.zero();
  f.outstanding = BigInt.zero();
  f.drawdownCount = 0;
  f.lenderCount = 0;
  f.save();

  protocol.facilityCount = protocol.facilityCount + 1;
  protocol.save();

  // Start indexing this clone's events.
  Pool.create(pool);
}
