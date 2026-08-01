#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { MindArtStore } from "./store.js";

async function main(): Promise<void> {
  const store = new MindArtStore();
  await store.initialize();
  process.stderr.write(`[MindArt] project root: ${store.projectRoot}\n`);

  const server = createServer({ store });
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[MindArt] fatal error: ${message}\n`);
  process.exitCode = 1;
});
