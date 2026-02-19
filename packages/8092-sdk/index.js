/**
 * Workspace shim for `@agentic-trust/8092-sdk`.
 *
 * `@agentic-trust/core@1.0.42` and `@agentic-trust/8004-ext-sdk@1.0.42` import:
 * - `AssociationsStoreClient`
 * - `ASSOCIATIONS_STORE_ABI`
 * - `formatEvmV1`, `tryParseEvmV1`
 * - `eip712Hash`
 *
 * This shim is only to unblock installs/builds until the upstream package is published.
 */

import {
  bytesToHex,
  concat,
  concatHex,
  encodeAbiParameters,
  hexToBytes,
  keccak256,
  parseAbiParameters,
  stringToHex,
  toHex,
} from "viem";

export const ASSOCIATIONS_STORE_ABI = [
  "function storeAssociation((uint40 revokedAt,bytes2 initiatorKeyType,bytes2 approverKeyType,bytes initiatorSignature,bytes approverSignature,(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data) record) sar)",
  "function updateAssociationSignatures(bytes32 associationId, bytes initiatorSignature, bytes approverSignature)",
  "function revokeAssociation(bytes32 associationId, uint40 revokedAt)",
  "function getAssociationsForAccount(bytes account) view returns ((uint40 revokedAt,bytes2 initiatorKeyType,bytes2 approverKeyType,bytes initiatorSignature,bytes approverSignature,(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data) record)[] sars)",
  "function getAssociation(bytes32 associationId) view returns ((uint40 revokedAt,bytes2 initiatorKeyType,bytes2 approverKeyType,bytes initiatorSignature,bytes approverSignature,(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data) record) sar)",
];

function toMinimalBigEndianBytes(n) {
  // viem's toHex is minimal already (no leading zeros).
  return hexToBytes(toHex(BigInt(n)));
}

export function formatEvmV1(chainId, address) {
  if (typeof address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(`Invalid EVM address: ${String(address)}`);
  }
  const chainRef = toMinimalBigEndianBytes(chainId);
  const head = hexToBytes("0x00010000");
  const addrBytes = hexToBytes(address);
  const out = concat([
    head,
    Uint8Array.of(chainRef.length),
    chainRef,
    Uint8Array.of(addrBytes.length),
    addrBytes,
  ]);
  return bytesToHex(out);
}

export function tryParseEvmV1(value) {
  if (typeof value !== "string" || !value.startsWith("0x")) return null;
  let bytes;
  try {
    bytes = hexToBytes(value);
  } catch {
    return null;
  }
  if (bytes.length < 4) return null;
  // 0x00010000
  if (bytes[0] !== 0x00 || bytes[1] !== 0x01 || bytes[2] !== 0x00 || bytes[3] !== 0x00) {
    return null;
  }
  let i = 4;
  if (i >= bytes.length) return null;
  const chainLen = bytes[i++];
  if (i + chainLen > bytes.length) return null;
  const chainBytes = bytes.slice(i, i + chainLen);
  i += chainLen;
  if (i >= bytes.length) return null;
  const addrLen = bytes[i++];
  if (i + addrLen > bytes.length) return null;
  const addrBytes = bytes.slice(i, i + addrLen);
  if (addrBytes.length !== 20) return null;

  let chainId = 0n;
  for (const b of chainBytes) chainId = (chainId << 8n) + BigInt(b);

  return {
    chainId: Number(chainId),
    address: bytesToHex(addrBytes),
  };
}

export function eip712Hash(record) {
  const DOMAIN_TYPEHASH = keccak256(stringToHex("EIP712Domain(string name,string version)"));
  const NAME_HASH = keccak256(stringToHex("AssociatedAccounts"));
  const VERSION_HASH = keccak256(stringToHex("1"));
  const MESSAGE_TYPEHASH = keccak256(
    stringToHex(
      "AssociatedAccountRecord(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data)"
    )
  );

  const domainSeparator = keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, bytes32, bytes32"), [
      DOMAIN_TYPEHASH,
      NAME_HASH,
      VERSION_HASH,
    ])
  );

  const structHash = keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, bytes32, bytes32, uint40, uint40, bytes4, bytes32"), [
      MESSAGE_TYPEHASH,
      keccak256(record.initiator),
      keccak256(record.approver),
      BigInt(record.validAt ?? 0),
      BigInt(record.validUntil ?? 0),
      record.interfaceId,
      keccak256(record.data),
    ])
  );

  return keccak256(concatHex(["0x1901", domainSeparator, structHash]));
}

export class AssociationsStoreClient {
  constructor(associationsProxyAddress, provider) {
    this.associationsProxyAddress = associationsProxyAddress;
    this.provider = provider;
  }

  async getAssociationsForEvmAccount(_params) {
    return [];
  }

  async getSignedAssociationsForEvmAccount(_params) {
    return [];
  }
}

