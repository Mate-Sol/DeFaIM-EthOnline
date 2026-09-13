'use strict';

/**
 * Privy-backed signer for the server's on-chain agent role.
 *
 * The server holds AGENT2_ROLE, which lets it call executeDrawdown() — the one
 * privileged action that moves lender capital to a borrower. Until now that
 * authority was a raw private key sitting in AGENT_PRIVATE_KEY: anything that
 * could read the environment could sign as the agent, forever, from anywhere.
 *
 * With Privy the key material lives in a secure enclave and never reaches this
 * process. We ask for a signature; the enclave decides whether the policy
 * attached to the wallet permits it. Compromising the server yields the
 * ability to *request* a signature, not to take the key.
 *
 * Arc is not in Privy's supported-chain list, so eth_sendTransaction — which
 * would have Privy broadcast for us — is not usable. We sign with Privy and
 * broadcast through our own Arc RPC instead. Implementing signTransaction() on
 * an ethers AbstractSigner is enough for the contract wrappers to work
 * unchanged: ethers populates nonce and gas, calls us to sign, then hands the
 * raw transaction to the provider.
 */

const { ethers } = require('ethers');

const PRIVY_API = process.env.PRIVY_API_URL || 'https://api.privy.io';

class PrivySigner extends ethers.AbstractSigner {
  constructor({ appId, appSecret, walletId, address, provider, authorizationKey }) {
    super(provider);
    if (!appId || !appSecret) throw new Error('PrivySigner: appId and appSecret are required');
    if (!walletId) throw new Error('PrivySigner: walletId is required');
    if (!address) throw new Error('PrivySigner: wallet address is required');
    this.appId = appId;
    this.appSecret = appSecret;
    this.walletId = walletId;
    this.address = ethers.getAddress(address);
    this.authorizationKey = authorizationKey || '';
  }

  async getAddress() {
    return this.address;
  }

  connect(provider) {
    return new PrivySigner({
      appId: this.appId,
      appSecret: this.appSecret,
      walletId: this.walletId,
      address: this.address,
      authorizationKey: this.authorizationKey,
      provider,
    });
  }

  async _rpc(body) {
    const auth = Buffer.from(`${this.appId}:${this.appSecret}`).toString('base64');
    const headers = {
      Authorization: `Basic ${auth}`,
      'privy-app-id': this.appId,
      'Content-Type': 'application/json',
    };
    if (this.authorizationKey) {
      headers['privy-authorization-signature'] = this.authorizationKey;
    }

    const res = await fetch(`${PRIVY_API}/v1/wallets/${this.walletId}/rpc`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }

    if (!res.ok) {
      // A policy denial is not an outage, and the two want different
      // responses: one is a decision to surface, the other is a retry.
      const message = payload?.error || payload?.message || text.slice(0, 200);
      const err = new Error(`Privy ${res.status}: ${message}`);
      err.status = res.status;
      // Privy returns 400 for a policy violation, not 403, so the status alone
      // cannot separate a denial from a malformed request — verified against
      // the live API by signing a transaction the policy forbids.
      err.policyDenied =
        res.status === 403 || /policy violation|denied due to policy/i.test(String(message));
      throw err;
    }
    return payload;
  }

  /**
   * Map an ethers transaction request onto Privy's transaction object.
   *
   * ethers hands us BigInts and a populated `from`; Privy wants hex strings and
   * rejects unknown fields. Anything null or undefined is dropped rather than
   * sent as null, which the API treats as a malformed value.
   */
  static toPrivyTransaction(tx) {
    // JSON-RPC quantity encoding: minimal hex, no leading zeros. ethers'
    // toBeHex() pads to a whole byte (0x03e8), which strict decoders reject.
    const hex = (v) => {
      if (v === null || v === undefined) return undefined;
      try { return `0x${BigInt(v).toString(16)}`; } catch { return undefined; }
    };
    const out = {
      to: tx.to ? ethers.getAddress(String(tx.to)) : undefined,
      value: hex(tx.value ?? 0n),
      data: tx.data && tx.data !== '0x' ? tx.data : undefined,
      chain_id: tx.chainId === undefined || tx.chainId === null ? undefined : Number(tx.chainId),
      nonce: tx.nonce === undefined || tx.nonce === null ? undefined : Number(tx.nonce),
      gas_limit: hex(tx.gasLimit),
      max_fee_per_gas: hex(tx.maxFeePerGas),
      max_priority_fee_per_gas: hex(tx.maxPriorityFeePerGas),
    };
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out;
  }

  async signTransaction(tx) {
    const transaction = PrivySigner.toPrivyTransaction(tx);
    // eth_signTransaction takes only params.transaction — it rejects the
    // caip2 and chain_type keys that eth_sendTransaction requires, because it
    // never touches a network. The chain is identified by the transaction's
    // own chain_id, which is also what the policy matches on.
    const body = {
      method: 'eth_signTransaction',
      params: { transaction },
    };
    const out = await this._rpc(body);
    const signed = out?.data?.signed_transaction ?? out?.signed_transaction;
    if (!signed) {
      throw new Error(`Privy returned no signed transaction: ${JSON.stringify(out).slice(0, 200)}`);
    }
    return signed;
  }

  async signMessage(message) {
    const out = await this._rpc({
      method: 'personal_sign',
      params: {
        message: typeof message === 'string' ? message : ethers.hexlify(message),
        encoding: typeof message === 'string' ? 'utf-8' : 'hex',
      },
    });
    const sig = out?.data?.signature ?? out?.signature;
    if (!sig) throw new Error('Privy returned no signature');
    return sig;
  }

  async signTypedData() {
    // Not needed by any server-signed path; fail loudly rather than silently
    // returning something unusable.
    throw new Error('PrivySigner: signTypedData is not implemented');
  }
}

/**
 * The policy attached to the agent wallet.
 *
 * The rule is narrow on purpose. On Arc, USDC *is* the native token, so a
 * transaction carrying value is a direct transfer of money. Every legitimate
 * agent action — executeDrawdown, setPaused, setScOverdue — is a contract call
 * with value zero. Denying non-zero value therefore costs the agent nothing it
 * needs and removes the one thing a stolen signature could do outright: move
 * funds to an arbitrary address.
 *
 * Drawdown safety still rests on-chain, where AGENT2_ROLE can only pay an
 * already-authorised receiver. This is defence in depth, not a replacement.
 */
function agentPolicyDocument({ chainId = 5042002, ownerId } = {}) {
  const policy = {
    version: '1.0',
    name: 'DeFa agent: zero-value calls only',
    chain_type: 'ethereum',
    rules: [
      {
        name: 'Deny native value transfer',
        method: 'eth_signTransaction',
        action: 'DENY',
        conditions: [
          {
            field_source: 'ethereum_transaction',
            field: 'value',
            operator: 'gt',
            value: '0',
          },
        ],
      },
      {
        name: `Allow calls on eip155:${chainId}`,
        method: 'eth_signTransaction',
        action: 'ALLOW',
        conditions: [
          {
            field_source: 'ethereum_transaction',
            field: 'chain_id',
            operator: 'eq',
            value: String(chainId),
          },
        ],
      },
    ],
  };
  if (ownerId) policy.owner_id = ownerId;
  return policy;
}

module.exports = { PrivySigner, agentPolicyDocument, PRIVY_API };
