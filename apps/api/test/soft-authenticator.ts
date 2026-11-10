/**
 * Minimal software WebAuthn authenticator for tests: a real P-256 key, "none" attestation,
 * user-presence + user-verification flags. Produces responses @simplewebauthn verifies for real.
 */
import { Encoder } from "cbor-x";
import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";

const cbor = new Encoder({ tagUint8Array: false, mapsAsObjects: false, useRecords: false });
const b64u = (b: Buffer) => b.toString("base64url");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();

export class SoftAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  private signCount = 0;
  userHandle = "";

  constructor(
    private readonly rpId: string,
    private readonly origin: string,
  ) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    this.publicJwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  }

  private clientData(type: string, challenge: string, origin = this.origin): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  register(
    options: { challenge: string; user: { id: string } },
    overrides: { origin?: string } = {},
  ) {
    this.userHandle = options.user.id;
    const coseKey = cbor.encode(
      new Map<number, number | Buffer>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(this.publicJwk.x, "base64url")],
        [-3, Buffer.from(this.publicJwk.y, "base64url")],
      ]),
    );
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([0x45]),
      Buffer.alloc(4),
      Buffer.alloc(16),
      idLen,
      this.credentialId,
      coseKey,
    ]);
    const attestationObject = cbor.encode(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64u(
          this.clientData("webauthn.create", options.challenge, overrides.origin),
        ),
        attestationObject: b64u(Buffer.from(attestationObject)),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  authenticate(options: { challenge: string }) {
    this.signCount += 1;
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.signCount);
    const authData = Buffer.concat([sha256(this.rpId), Buffer.from([0x05]), counter]);
    const clientDataJSON = this.clientData("webauthn.get", options.challenge);
    const signature = createSign("sha256")
      .update(Buffer.concat([authData, sha256(clientDataJSON)]))
      .sign(this.privateKey);
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
        userHandle: this.userHandle,
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
