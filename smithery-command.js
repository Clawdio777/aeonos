module.exports = (config) => ({
  command: "npx",
  args: ["-y", "aeonos-mcp"],
  env: {
    AEONOS_PRIVATE_KEY: config.AEONOS_PRIVATE_KEY,
  },
});
