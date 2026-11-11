import assert from "node:assert/strict";
import { test } from "node:test";
import { MCP_TOOLS, MCP_TOOL_NAMES, skillGetInputSchema, attemptInstructionsSchema } from "@factory/contracts";
for(const name of ["verify","a","0","a-b","a".repeat(80)])test(`skill input accepts valid name of length ${name.length}: ${name.slice(0,5)}`,()=>assert.deepEqual(skillGetInputSchema.parse({name}),{name}));
for(const [label,name]of [["empty",""],["uppercase","Verify"],["traversal","../verify"],["underscore","skill_name"],["leading hyphen","-verify"],["length","a".repeat(81)],["newline","verify\n"],["NUL","verify\0"]])test(`skill input rejects ${label}`,()=>assert.equal(skillGetInputSchema.safeParse({name}).success,false));
test("skill input rejects caller identity",()=>assert.equal(skillGetInputSchema.safeParse({name:"verify",seatId:"other"}).success,false));
test("skill get is registered additively",()=>{assert.equal(MCP_TOOLS["skill.get"],skillGetInputSchema);assert.ok(MCP_TOOL_NAMES.includes("skill.get"));assert.ok(MCP_TOOL_NAMES.includes("knowledge.get"));});
test("instruction view validates exact provenance",()=>{assert.ok(attemptInstructionsSchema.safeParse({packDigest:"a".repeat(64),profilePath:"worker.md",skillsCount:1,bytes:20}).success);assert.equal(attemptInstructionsSchema.safeParse({packDigest:"bad",profilePath:"worker.md",skillsCount:-1,bytes:20}).success,false);});
