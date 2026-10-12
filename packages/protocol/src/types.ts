export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = {
  [key: string]: JsonValue;
};

export type HexSha256 = string;

export type Base64Url = string;

export type IsoTimestamp = string;

export interface GeoLocation extends JsonObject {
  lat: number;
  lng: number;
}

export interface SearchResult extends JsonObject {
  position?: number;
  title?: string;
  link?: string;
  snippet?: string;
  displayedLink?: string;
}

export interface RelatedQuestion extends JsonObject {
  question: string;
  answer?: JsonValue;
  link?: string;
}