import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "docs/transcripts/2026-10-05-build-session";
const columns = [
  "input_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
  "output_tokens",
];

const readEntries = (file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

const emptyTotals = () => ({
  ...Object.fromEntries(columns.map((column) => [column, 0])),
  calls: 0,
  first: "",
  last: "",
});

const total = (totals) => columns.reduce((sum, column) => sum + totals[column], 0);

const addCall = (totals, call) => {
  for (const column of columns) totals[column] += call.usage[column] ?? 0;
  totals.calls += 1;
  if (!totals.first || call.timestamp < totals.first) totals.first = call.timestamp;
  if (!totals.last || call.timestamp > totals.last) totals.last = call.timestamp;
};

const addTotals = (target, source) => {
  for (const column of columns) target[column] += source[column];
  target.calls += source.calls;
  if (source.first && (!target.first || source.first < target.first)) target.first = source.first;
  if (source.last && (!target.last || source.last > target.last)) target.last = source.last;
};

const apiCalls = (entries) => {
  const byId = new Map();
  for (const entry of entries) {
    if (entry.type !== "assistant" || !entry.message?.usage) continue;
    const id = entry.message.id ?? entry.requestId ?? entry.uuid;
    if (byId.has(id)) continue;
    byId.set(id, {
      usage: entry.message.usage,
      model: entry.message.model ?? "unknown",
      timestamp: entry.timestamp,
    });
  }
  return [...byId.values()];
};

const summarize = (calls) => {
  const totals = emptyTotals();
  for (const call of calls) addCall(totals, call);
  return totals;
};

const blocksOf = (entry) => (Array.isArray(entry.message?.content) ? entry.message.content : []);

const agentIdFromResult = (entry, block) => {
  if (entry.toolUseResult?.agentId) return entry.toolUseResult.agentId;
  const text =
    typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
  return text.match(/agentId: ([a-f0-9]+)/)?.[1];
};

const collectAgentCalls = (entries) => {
  const pending = new Map();
  const spawns = [];
  const resumes = [];
  for (const entry of entries) {
    for (const block of blocksOf(entry)) {
      if (block.type === "tool_use" && block.name === "Agent")
        pending.set(block.id, { entry, block });
      if (block.type === "tool_use" && block.name === "SendMessage") {
        const to = block.input?.to ?? block.input?.recipient;
        if (to && block.input?.summary) resumes.push({ agentId: to, summary: block.input.summary });
      }
      if (block.type === "tool_result" && pending.has(block.tool_use_id)) {
        const call = pending.get(block.tool_use_id);
        const agentId = agentIdFromResult(entry, block);
        if (agentId) {
          spawns.push({
            agentId,
            description: call.block.input?.description ?? "",
            timestamp: call.entry.timestamp,
          });
        }
      }
    }
  }
  return { spawns, resumes };
};

const userText = (entry) => {
  if (entry.type !== "user" || entry.isMeta || entry.isCompactSummary) return undefined;
  const content = entry.message?.content;
  const text =
    typeof content === "string"
      ? content
      : blocksOf(entry)
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join(" ");
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (
    /^<(task-notification|local-command-stdout|local-command-caveat|system-reminder)/.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
};

const mainEntries = readEntries(join(dir, "main.jsonl"));
const agentsDir = join(dir, "agents");
const agentFiles = existsSync(agentsDir)
  ? readdirSync(agentsDir)
      .filter((name) => name.endsWith(".jsonl"))
      .sort()
  : [];
const agentEntries = new Map(
  agentFiles.map((name) => [
    name.replace(/^agent-/, "").replace(/\.jsonl$/, ""),
    readEntries(join(agentsDir, name)),
  ]),
);

const spawnOf = new Map();
const summariesOf = new Map();
for (const entries of [mainEntries, ...agentEntries.values()]) {
  const { spawns, resumes } = collectAgentCalls(entries);
  for (const spawn of spawns) if (!spawnOf.has(spawn.agentId)) spawnOf.set(spawn.agentId, spawn);
  for (const { agentId, summary } of resumes) {
    summariesOf.set(agentId, [...(summariesOf.get(agentId) ?? []), summary]);
  }
}

const mainCalls = apiCalls(mainEntries);
const transcripts = [
  { name: "main.jsonl", label: "main session", calls: mainCalls, totals: summarize(mainCalls) },
  ...[...agentEntries].map(([agentId, entries]) => {
    const calls = apiCalls(entries);
    const spawn = spawnOf.get(agentId);
    const resumes = summariesOf.get(agentId) ?? [];
    const label = spawn
      ? [spawn.description, ...resumes.map((summary) => `resumed: ${summary}`)].join("; ")
      : "unmapped";
    return {
      name: `agents/agent-${agentId}.jsonl`,
      agentId,
      label,
      calls,
      totals: summarize(calls),
    };
  }),
];

const grand = emptyTotals();
for (const transcript of transcripts) addTotals(grand, transcript.totals);

const byModel = new Map();
for (const transcript of transcripts) {
  for (const call of transcript.calls) {
    if (!byModel.has(call.model)) byModel.set(call.model, emptyTotals());
    addCall(byModel.get(call.model), call);
  }
}

const segments = [];
for (const entry of mainEntries) {
  const text = userText(entry);
  if (!text) continue;
  segments.push({
    timestamp: entry.timestamp,
    label: text.replace(/\s+/g, " ").slice(0, 100),
    main: emptyTotals(),
    agents: emptyTotals(),
    agentCount: 0,
  });
}
const segmentAt = (timestamp) => {
  let found;
  for (const segment of segments) if (segment.timestamp <= timestamp) found = segment;
  return found ?? segments[0];
};
for (const call of mainCalls) addCall(segmentAt(call.timestamp).main, call);
for (const transcript of transcripts.slice(1)) {
  const spawn = spawnOf.get(transcript.agentId);
  if (!spawn) continue;
  const segment = segmentAt(spawn.timestamp);
  addTotals(segment.agents, transcript.totals);
  segment.agentCount += 1;
}

const cell = (value) => String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
const table = (headers, rows) =>
  [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
const tokenCells = (totals) => [
  ...columns.map((column) => totals[column]),
  total(totals),
  totals.calls,
];
const tokenHeaders = ["input", "cache write", "cache read", "output", "total", "calls"];

const markdown = [
  "# Token usage, build session",
  "",
  'input_tokens excludes cache reads and cache writes, so "context seen" per call is input + cache write + cache read.',
  "",
  "## Grand total",
  "",
  table([...tokenHeaders, "first", "last"], [[...tokenCells(grand), grand.first, grand.last]]),
  "",
  "## Per transcript",
  "",
  table(
    ["transcript", "description", "models", ...tokenHeaders, "first", "last"],
    transcripts.map((transcript) => [
      transcript.name,
      transcript.label,
      [...new Set(transcript.calls.map((call) => call.model))].join(", "),
      ...tokenCells(transcript.totals),
      transcript.totals.first,
      transcript.totals.last,
    ]),
  ),
  "",
  "## Per request",
  "",
  table(
    ["timestamp", "request", "main total", "agents", "agent total", "sum"],
    segments.map((segment) => [
      segment.timestamp,
      segment.label,
      total(segment.main),
      segment.agentCount,
      total(segment.agents),
      total(segment.main) + total(segment.agents),
    ]),
  ),
  "",
  "## Per model",
  "",
  table(
    ["model", ...tokenHeaders],
    [...byModel].map(([model, totals]) => [model, ...tokenCells(totals)]),
  ),
  "",
].join("\n");

const csvCell = (value) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csvHeader = [
  "kind",
  "name",
  "label",
  "timestamp",
  ...columns,
  "total",
  "calls",
  "agents",
  "agent_total",
  "sum",
];
const csvRows = [
  ...transcripts.map((transcript) => [
    "transcript",
    transcript.name,
    transcript.label,
    transcript.totals.first,
    ...columns.map((column) => transcript.totals[column]),
    total(transcript.totals),
    transcript.totals.calls,
    "",
    "",
    total(transcript.totals),
  ]),
  ...segments.map((segment) => [
    "segment",
    "main.jsonl",
    segment.label,
    segment.timestamp,
    ...columns.map((column) => segment.main[column]),
    total(segment.main),
    segment.main.calls,
    segment.agentCount,
    total(segment.agents),
    total(segment.main) + total(segment.agents),
  ]),
];
const csv = [csvHeader, ...csvRows].map((row) => row.map(csvCell).join(",")).join("\n");

writeFileSync(join(dir, "usage.md"), markdown);
writeFileSync(join(dir, "usage.csv"), `${csv}\n`);
