// The single entry point the binary is built from: `crew-studio` serves Studio;
// `crew-studio mcp` and `crew-studio permission-mcp` are the stdio helpers the
// agent CLIs start, so the binary needs nothing else installed.
const sub = process.argv[2];
if (sub === "mcp") await import("./mcp");
else if (sub === "check-script") { process.argv.splice(2, 1); await import("./check-script"); }
else if (sub === "permission-mcp") await import("./permission-mcp");
else if (sub === "--version" || sub === "version") console.log("crew-studio 0.4.0");
else if (sub === "open" || sub === "launch") await import("./open"); // the captain's explicit step that starts a browser session
// the crew-studio CLI (src/cli.ts, docs/units/cli.md): an external agent's commands, through the captain's grant
// any other word is a CLI command too (an unknown one is a usage error, exit 2): only no argument at all starts Studio, so a
// mistyped command never starts a server on Studio's port
else if (sub !== undefined && !sub.startsWith("-")) await (await import("./cli")).main(process.argv.slice(2));
else await import("./server");
export {};
