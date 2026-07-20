import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  baseGenerationId,
  usageFromClaudeTranscriptText,
  usageFromCodexTranscriptText,
} from "../scripts/capture.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(here, "fixtures", name), "utf8");
const panelText = fs.readFileSync(path.join(here, "..", "assets", "index.html"), "utf8");

function panelFunction(name, args) {
  const match = panelText.match(new RegExp(`function ${name}\\(${args}\\)\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `missing panel function ${name}`);
  return Function(...args.split(","), match[1]);
}

test("all providers resolve a stable turn id", () => {
  const rows = JSON.parse(fixture("provider-events.json"));
  const turnGenId = panelFunction("turnGenId", "ev");
  for (const row of rows) {
    assert.equal(baseGenerationId(row.event), row.turn, `${row.name} capture turn`);
    assert.equal(turnGenId(row.event), row.turn, `${row.name} panel turn`);
  }
});

test("Codex usage is scoped by turn and sums last_token_usage only", () => {
  const text = fixture("codex-rollout.jsonl");
  assert.deepEqual(usageFromCodexTranscriptText(text, "codex-turn-a"), {
    input_tokens: 2200,
    output_tokens: 180,
    cache_read_tokens: 1000,
    cache_write_tokens: 100,
    context_tokens: 1200,
    llm_calls: 2,
    input_tokens_inclusive: true,
  });
  assert.deepEqual(usageFromCodexTranscriptText(text, "codex-turn-b"), {
    input_tokens: 2000,
    output_tokens: 200,
    cache_read_tokens: 1000,
    cache_write_tokens: 0,
    context_tokens: 2000,
    llm_calls: 1,
    input_tokens_inclusive: true,
  });
});

test("Codex inclusive input subtracts cache without changing billed input", () => {
  const normalizeUsage = panelFunction(
    "normalizeUsage",
    "rawInput, rawOutput, rawCacheRead, rawCacheWrite, preferInclusive"
  );
  assert.deepEqual(normalizeUsage(2200, 180, 1000, 100, true), {
    input: 1100,
    output: 180,
    cacheRead: 1000,
    cacheWrite: 100,
    billedInput: 2200,
    inclusive: true,
  });
});

test("Claude usage keeps non-cached input semantics and deduplicates messages", () => {
  const usage = usageFromClaudeTranscriptText(
    fixture("claude-transcript.jsonl"),
    "claude-turn-a"
  );
  assert.deepEqual(usage, {
    input_tokens: 250,
    output_tokens: 50,
    cache_read_tokens: 100,
    cache_write_tokens: 15,
    context_tokens: 215,
    llm_calls: 2,
    input_tokens_inclusive: false,
  });
});
