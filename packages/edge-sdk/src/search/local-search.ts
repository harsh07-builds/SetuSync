import MiniSearch from "minisearch";
import type { Capsule, SearchResult } from "@setusync/protocol";

export interface LocalSearchDocument {
  id: string;
  capsuleId: string;
  resultPosition: number;
  engine: string;
  title: string;
  snippet: string;
  link: string;
  displayedLink: string;
  text: string;
}

export interface LocalSearchHit {
  id: string;
  capsuleId: string;
  resultPosition: number;
  engine: string;
  title: string;
  snippet: string;
  link: string;
  displayedLink: string;
  score: number;
}

function toSearchDocument(
  capsule: Capsule,
  result: SearchResult,
  resultIndex: number,
): LocalSearchDocument {
  const title = result.title ?? "";
  const snippet = result.snippet ?? "";
  const link = result.link ?? "";
  const displayedLink = result.displayedLink ?? "";

  return {
    id: `${capsule.body.id}:${resultIndex}`,
    capsuleId: capsule.body.id,
    resultPosition: result.position ?? resultIndex + 1,
    engine: capsule.body.engine,
    title,
    snippet,
    link,
    displayedLink,
    text: `${title} ${snippet} ${link} ${displayedLink}`,
  };
}

export class LocalSearchIndex {
  private readonly documents = new Map<string, LocalSearchDocument>();

  private readonly index = new MiniSearch<LocalSearchDocument>({
    fields: [
      "title",
      "snippet",
      "text",
      "engine",
    ],
    storeFields: [
      "capsuleId",
      "resultPosition",
      "engine",
      "title",
      "snippet",
      "link",
      "displayedLink",
    ],
    searchOptions: {
      prefix: true,
      fuzzy: 0.1,
      combineWith: "AND",
      boost: {
        title: 3,
        snippet: 2,
      },
    },
  });

  public indexCapsule(capsule: Capsule): void {
    this.removeCapsule(capsule.body.id);

    const documents = capsule.body.organic_results.map(
      (result, resultIndex) =>
        toSearchDocument(capsule, result, resultIndex),
    );

    for (const document of documents) {
      this.documents.set(document.id, document);
    }

    this.index.addAll(documents);
  }

  public indexCapsules(capsules: readonly Capsule[]): void {
    for (const capsule of capsules) {
      this.indexCapsule(capsule);
    }
  }

  public removeCapsule(capsuleId: string): void {
    const documentsToRemove = Array.from(
      this.documents.values(),
    ).filter((document) => document.capsuleId === capsuleId);

    if (documentsToRemove.length === 0) {
      return;
    }

    this.index.removeAll(documentsToRemove);

    for (const document of documentsToRemove) {
      this.documents.delete(document.id);
    }
  }

  public clear(): void {
    this.index.removeAll();
    this.documents.clear();
  }

  public search(query: string, limit = 20): LocalSearchHit[] {
    const normalizedQuery = query.trim();

    if (normalizedQuery.length === 0 || limit <= 0) {
      return [];
    }

    return this.index
      .search(normalizedQuery)
      .slice(0, limit)
      .map((result) => ({
        id: String(result.id),
        capsuleId: String(result.capsuleId),
        resultPosition: Number(result.resultPosition),
        engine: String(result.engine),
        title: String(result.title ?? ""),
        snippet: String(result.snippet ?? ""),
        link: String(result.link ?? ""),
        displayedLink: String(result.displayedLink ?? ""),
        score: result.score,
      }));
  }

  public get documentCount(): number {
    return this.documents.size;
  }
}