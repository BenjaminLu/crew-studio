// The single entry point the binary is built from: `crew-studio` serves Studio;
// `crew-studio mcp` and `crew-studio permission-mcp` are the stdio helpers the
// agent CLIs start, so the binary needs nothing else installed.
const sub = process.argv[2];
if (sub === "mcp") await import("./mcp");
else if (sub === "check-script") { process.argv.splice(2, 1); await import("./check-script"); }
else if (sub === "permission-mcp") await import("./permission-mcp");
else if (sub === "--version" || sub === "version") console.log("crew-studio 0.4.0");
else if (sub === "open" || sub === "launch") await import("./open"); // the captain's explicit step that starts a browser session
else await import("./server");
export {};
