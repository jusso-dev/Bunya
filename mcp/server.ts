import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBunyaMcpServer } from "./create-server";

async function main() {
  await createBunyaMcpServer().connect(new StdioServerTransport());
}

void main().catch((error) => {
  console.error("Bunya MCP server failed to start:", error);
  process.exitCode = 1;
});
