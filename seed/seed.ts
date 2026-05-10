/**
 * seed.ts — Load aeo_knowledge seed data into Supabase
 *
 * Usage:
 *   bun run seed/seed.ts
 *
 * Requires .env with:
 *   SUPABASE_URL=
 *   SUPABASE_SERVICE_KEY=
 *   OPENAI_API_KEY=   (optional — set to generate embeddings now, or run embed step later)
 */

import { createClient } from "@supabase/supabase-js";
import seedData from "./seed.json" with { type: "json" };

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const OPENAI_KEY   = process.env.OPENAI_API_KEY || "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

async function getEmbedding(text: string): Promise<number[] | null> {
  if (!OPENAI_KEY) return null;
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  if (!res.ok) {
    console.warn(`Embedding failed: ${res.status}`);
    return null;
  }
  const data = await res.json() as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

async function main() {
  console.log(`Seeding ${seedData.entries.length} knowledge entries...`);

  for (const entry of seedData.entries) {
    // Build text for embedding: category + query_pattern + content title + summary
    const embedText = [
      entry.category,
      entry.query_pattern,
      (entry.content as any).title || "",
      (entry.content as any).summary || "",
    ].join(" | ");

    const embedding = await getEmbedding(embedText);

    const row = {
      category:      entry.category,
      query_pattern: entry.query_pattern,
      content:       entry.content,
      sources:       entry.sources || [],
      ...(embedding ? { embedding: `[${embedding.join(",")}]` } : {}),
    };

    const { error } = await db.from("aeo_knowledge").upsert(row, {
      onConflict: "category,query_pattern",
    });

    if (error) {
      console.error(`Failed to insert "${entry.query_pattern}":`, error.message);
    } else {
      console.log(`✓ ${entry.category} | ${entry.query_pattern}`);
    }
  }

  console.log("\nSeed complete.");
  if (!OPENAI_KEY) {
    console.log("Note: No OPENAI_API_KEY set — embeddings not generated. Run embed step separately.");
  }
}

main().catch(console.error);
