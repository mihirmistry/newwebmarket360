// Entry point for LiteSpeed (lsnode.js) and other cloud environments.
// Dynamic import() avoids top-level await in the module graph when required by CommonJS loaders.
void import("./dist/server.js").catch((err) => {
  console.error("Failed to start application:", err);
  process.exit(1);
});
