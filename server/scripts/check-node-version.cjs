const major = Number(process.versions.node.split(".")[0]);
const supported = [18, 20, 22, 23];

if (!supported.includes(major)) {
  console.error(
    `\n@speed/server uses uWebSockets.js, which ships native binaries for Node ${supported.join(", ")}.\n` +
      `Current Node is ${process.versions.node}.\n\n` +
      "Use Node 22 for local dev:\n" +
      "  nvm install 22\n" +
      "  nvm use\n" +
      "  npm install\n" +
      "  npm run dev --workspace server\n\n" +
      "Or run the backend in Docker:\n" +
      "  docker compose up --build server\n"
  );
  process.exit(1);
}
