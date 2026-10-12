import type {
  Base64Url,
  HexSha256,
  IsoTimestamp,
  JsonObject,
  RelatedQuestion,
  SearchResult,
} from "./types.js";

export interface CapsuleRequest extends JsonObject {
  engine: string;
  query: string;
  params?: JsonObject;
}

export interface CapsuleSource extends JsonObject {
  provider: string;
  searchId?: string;
  credits?: number;
  cache?: boolean;
}

export interface CapsuleMeta extends JsonObject {
  risk?: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  review?: "NONE" | "REVIEWED" | "FLAGGED";
  lang?: string;
}

export interface CapsuleBody extends JsonObject {
  id: HexSha256;
  key: HexSha256;
  chash: HexSha256;

  engine: string;
  params: JsonObject;

  fetched_at: IsoTimestamp;
  ttl_s: number;
  max_lease_s?: number;

  source: CapsuleSource;

  organic_results: SearchResult[];
  related_questions?: RelatedQuestion[];

  meta?: CapsuleMeta;
}

export interface CapsuleEnvelope extends JsonObject {
  v: number;
  kid: string;
  alg: "Ed25519";
  sig: Base64Url;
  body: CapsuleBody;
}

export type Capsule = CapsuleEnvelope;