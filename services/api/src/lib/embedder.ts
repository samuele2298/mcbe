// Embedding per la ricerca semantica della knowledge base. Servizio esterno (Voyage AI):
// sul VPS non c'è RAM per un modello locale. Senza chiave la ricerca usa il full-text di Postgres.

export interface Embedder {
  readonly dims: number;
  embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]>;
}

export class VoyageEmbedder implements Embedder {
  readonly dims = 1024;
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.VOYAGE_MODEL ?? 'voyage-3.5',
  ) {}

  async embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 64) {
      const res = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          input: texts.slice(i, i + 64),
          model: this.model,
          input_type: kind,
          output_dimension: this.dims,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
      out.push(...json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
    }
    return out;
  }
}

export function createEmbedder(): Embedder | null {
  const key = process.env.VOYAGE_API_KEY;
  return key ? new VoyageEmbedder(key) : null;
}

/** Formato testuale di pgvector. */
export const toPgVector = (v: number[]) => `[${v.map((x) => x.toFixed(6)).join(',')}]`;
