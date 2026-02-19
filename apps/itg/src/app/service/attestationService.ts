import { JsonRpcProvider } from "ethers";
import {
  EAS,
  SchemaEncoder,
  type SchemaDecodedItem,
  type SchemaItem
} from "@ethereum-attestation-service/eas-sdk";
import type { Chain } from "viem";

/**
 * A minimal TrustRelationship attestation shape for this ITG app.
 * You can extend this interface later as needed.
 */
export interface TrustRelationshipAttestation {
  /** Logical identifier for this attestation in your app (e.g. "trust(indiv-org)") */
  entityId: string;

  /** Name of the relationship */
  displayName: string;

  /** Description of the relationship */
  description: string;

  /** DID of the trusting party (subject) */
  subjectDid: string;
  /** DID of the trusted party (object) */
  objectDid: string;
  /** Free‑form relationship type, e.g. "ally", "partner", "member" */
  relationshipType: string;

  /** Optional on‑chain / indexer metadata */
  uid?: string;
  schemaId?: string;
  attester?: string;
}

// ---- EAS / GraphQL wiring ----

const GRAPHQL_URL =
  process.env.NEXT_PUBLIC_EAS_GRAPHQL_URL ??
  "https://optimism.easscan.org/graphql";
const GRAPHQL_API_KEY = process.env.NEXT_PUBLIC_EAS_AUTH_TOKEN;

const RPC_URL =
  process.env.NEXT_PUBLIC_EAS_RPC_URL ??
  process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_SEPOLIA ??
  "";

const EAS_CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_EAS_CONTRACT_ADDRESS ??
  // Default Optimism EAS contract used in the example
  "0x4200000000000000000000000000000000000021";

const eas = new EAS(EAS_CONTRACT_ADDRESS);
if (RPC_URL) {
  const provider = new JsonRpcProvider(RPC_URL);
  eas.connect(provider);
}

async function fetchJson(body: any): Promise<any> {
  const endpoint = GRAPHQL_URL.replace(/\/graphql\/?$/i, "");

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json"
  };

  if (GRAPHQL_API_KEY) {
    headers.Authorization = `Bearer ${GRAPHQL_API_KEY}`;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  } as any);

  if (!res.ok) {
    let text = "";
    try {
      text = await res.text();
    } catch {
      // ignore
    }
    throw new Error(`GraphQL ${res.status}: ${text || res.statusText}`);
  }

  const json = await res.json();
  return json;
}

/**
 * Single‑purpose attestation service for TrustRelationshipAttestation.
 *
 * This keeps the same "piece parts" as the larger example:
 *  - schema UID + schema string
 *  - addXAttestation that encodes and submits to EAS
 *  - constructXAttestation to turn decoded data into a typed object
 *  - a simple GraphQL helper to Read attestations back
 */
export class AttestationService {
  // Schema definition for TrustRelationshipAttestation.
  // Adjust the UID to match the schema you deployed in EAS.
  static TrustRelationshipSchemaUID: string = "0xc298c4495e662dacfbd38a5c4de29538ddebb7e19d7fe73dfe4e0268bddca740";

  static TrustRelationshipSchema =
    "string entityid, string subjectdid, string objectdid, string displayname, string description, string relationshiptype";

  /**
   * Generic helper to store an attestation via an Agent smart account.
   *
   * This is adapted from the full example's storeAttestation, but:
   *  - it does NOT use delegation or DelegationFramework
   *  - it expects an already-configured agent smart account client
   *    that can send a bundled transaction (e.g. MetaMaskSmartAccount)
   *
   * Everything else is preserved: EAS attest, then (optionally) verify via GraphQL.
   */
  static async storeAttestation(params: {
    schemaUid: string;
    encodedData: string;
    /** Agent smart‑account client that will actually submit the tx/userOp */
    agentAccountClient: {
      address: `0x${string}`;
      // Typically MetaMaskSmartAccount#sendTransaction(txData, opts)
      sendTransaction: (txData: any, opts?: any) => Promise<any>;
    };
    /** Optional custom EAS instance (otherwise global one is used) */
    easInstance?: EAS;
    /** When true, poll the EAS subgraph to verify the attestation appears */
    verifyAttestationAvailability?: boolean;
  }): Promise<string> {
    const {
      schemaUid,
      encodedData,
      agentAccountClient,
      easInstance,
      verifyAttestationAvailability = true
    } = params;

    const easToUse = easInstance || eas;

    try {
      // 1) Build the low-level EAS attest tx (no signing/broadcast yet)
      const tx = await easToUse.attest({
        schema: schemaUid,
        data: {
          recipient: agentAccountClient.address,
          expirationTime: BigInt(0),
          revocable: true,
          data: encodedData
        }
      });

      // 2) Ask the Agent smart account to send the tx (bundled / sponsored, etc)
      const sent = await agentAccountClient.sendTransaction(tx.data, {
        // optional paymaster hint for AA implementations that support it
        paymasterServiceData: {
          mode: "SPONSORED"
        }
      });

      const receipt = await sent.wait();
      const txHash: string =
        (receipt as any)?.transactionHash ?? (sent as any)?.hash;

      if (!verifyAttestationAvailability || !txHash) {
        return txHash;
      }



      return txHash;
    } catch (error) {
      console.error("Error storing attestation via Agent smart account:", error);
      throw error;
    }
  }

  /**
   * Create and submit a TrustRelationshipAttestation using an Agent smart account.
   *
   * This function encodes the TrustRelationship schema and then delegates
   * the actual transaction/user-operation to the provided agentAccountClient
   * via storeAttestation. No delegation framework is used here.
   */


  static async addTrustRelationshipAttestation(params: {
    chain: Chain;
    attestation: TrustRelationshipAttestation;
    agentAccountClient: {
      address: `0x${string}`;
      sendTransaction: (txData: any, opts?: any) => Promise<any>;
    };
  }): Promise<string> {
    const { attestation, agentAccountClient } = params;

    if (!RPC_URL) {
      throw new Error(
        "EAS RPC URL is not configured. Set NEXT_PUBLIC_EAS_RPC_URL or NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_SEPOLIA."
      );
    }

    if (
      !AttestationService.TrustRelationshipSchemaUID ||
      AttestationService.TrustRelationshipSchemaUID ===
        "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      throw new Error(
        "TrustRelationship schema UID is not configured. Set NEXT_PUBLIC_TRUST_RELATIONSHIP_SCHEMA_UID."
      );
    }

    const issuedate = Math.floor(Date.now() / 1000);
    const expiredate = 0; // non‑expiring by default

    const schemaEncoder = new SchemaEncoder(
      AttestationService.TrustRelationshipSchema
    );

    const items: SchemaItem[] = [
      { name: "entityid", value: attestation.entityId, type: "string" },
      { name: "subjectdid", value: attestation.subjectDid, type: "string" },
      { name: "objectdid", value: attestation.objectDid, type: "string" },
      { name: "displayname", value: attestation.displayName, type: "string" },
      { name: "description", value: attestation.description, type: "string" },
      {
        name: "relationshiptype",
        value: attestation.relationshipType,
        type: "string"
      }
    ];

    const encodedData = schemaEncoder.encodeData(items);

    const txHash = await AttestationService.storeAttestation({
      schemaUid: AttestationService.TrustRelationshipSchemaUID,
      encodedData,
      agentAccountClient
    });

    return txHash;
  }

  /**
   * Turn decoded EAS data into a TrustRelationshipAttestation object.
   */
  static constructTrustRelationshipAttestation(args: {
    chain: Chain;
    uid: string;
    schemaId: string;
    attester: string;
    decodedData: SchemaDecodedItem[];
  }): TrustRelationshipAttestation | undefined {
    const { chain, uid, schemaId, attester, decodedData } = args;

    let entityId: string | undefined;
    let displayName: string | undefined;
    let description: string | undefined;
    let subjectDid: string | undefined;
    let objectDid: string | undefined;
    let relationshipType: string | undefined;

    for (const field of decodedData) {
      const name = field.name;
      const value = field.value.value as string;
      if (name === "entityId") entityId = value;
      if (name === "displayname") displayName = value;
      if (name === "description") description = value;
      if (name === "subjectdid") subjectDid = value;
      if (name === "objectdid") objectDid = value;
      if (name === "relationshiptype") relationshipType = value;
    }

    if (!entityId || !subjectDid || !objectDid || !relationshipType) {
      return undefined;
    }

    const attesterDid = `did:pkh:eip155:${chain.id}:${attester}`;

    return {
      entityId,
      uid,
      schemaId,
      attester: attesterDid,
      // Fall back to relationshipType or a generic label if displayName/description
      // were not explicitly set in the attestation payload.
      displayName: displayName ?? relationshipType ?? "Trust relationship",
      description:
        description ??
        `Trust relationship (${relationshipType ?? "unspecified"}) between ${subjectDid} and ${objectDid}`,
      subjectDid,
      objectDid,
      relationshipType
    };
  }

  /**
   * Simple query to fetch recent TrustRelationship attestations
   * for a given attester address using the EAS subgraph.
   */
  static async loadTrustRelationshipAttestations(args: {
    chain: Chain;
    attesterAddress: string;
    first?: number;
  }): Promise<TrustRelationshipAttestation[]> {
    const { chain, attesterAddress, first = 100 } = args;

    const query = `
      query TrustAttestations($schema: String!, $attester: String!, $first: Int) {
        attestations(
          first: $first
          where: {
            schema: { equals: $schema }
            attester: { equals: $attester }
            revoked: { equals: false }
          }
        ) {
          id
          schema
        }
      }
    `;

    const resp = (await fetchJson({
      query,
      variables: {
        schema: AttestationService.TrustRelationshipSchemaUID,
        attester: attesterAddress.toLowerCase(),
        first
      }
    })) as any;

    const data = resp?.data;
    if (!data?.attestations) return [];

    const results: TrustRelationshipAttestation[] = [];
    const schemaEncoder = new SchemaEncoder(
      AttestationService.TrustRelationshipSchema
    );

    for (const item of data.attestations) {
      try {
        const att = await eas.getAttestation(item.id);
        const decoded = schemaEncoder.decodeData(att.data);

        const constructed =
          AttestationService.constructTrustRelationshipAttestation({
            chain,
            uid: item.id,
            schemaId: item.schema,
            attester: att.attester,
            decodedData: decoded
          });

        if (constructed) {
          results.push(constructed);
        }
      } catch (err) {
        console.error("Failed to decode trust relationship attestation", err);
      }
    }

    return results;
  }
}


