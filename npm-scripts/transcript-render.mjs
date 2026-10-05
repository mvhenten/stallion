import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: npm run transcript:render -- <input.jsonl> <output.md>");
  process.exit(1);
}

const oneLine = (text, max) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

const resultText = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join(" ");
};

const blocksOf = (message) => {
  if (typeof message?.content === "string") return [{ type: "text", text: message.content }];
  return Array.isArray(message?.content) ? message.content : [];
};

const renderBlock = (block) => {
  if (block.type === "text") return block.text.trim();
  if (block.type === "tool_use")
    return `- **${block.name}** \`${oneLine(JSON.stringify(block.input ?? {}), 120)}\``;
  if (block.type === "tool_result") return `  > ${oneLine(resultText(block.content), 300)}`;
  return "";
};

const out = [`# Transcript ${input.split("/").pop()}`, ""];
let currentRole = "";

for (const line of readFileSync(input, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const entry = JSON.parse(line);
  if (entry.type !== "user" && entry.type !== "assistant") continue;
  const blocks = blocksOf(entry.message);
  const onlyResults = blocks.length > 0 && blocks.every((block) => block.type === "tool_result");
  const role = entry.type === "user" && !onlyResults ? "user" : "assistant";
  if (role !== currentRole) {
    out.push(`## ${entry.timestamp ?? ""} ${role}`, "");
    currentRole = role;
  }
  const rendered = blocks.map(renderBlock).filter(Boolean);
  if (rendered.length > 0) out.push(rendered.join("\n\n"), "");
}

writeFileSync(output, out.join("\n"));
