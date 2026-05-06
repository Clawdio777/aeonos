FROM node:20-slim

# Install acp-cli globally
RUN npm install -g @virtuals-protocol/acp-cli

# Ensure Linux signer binary is executable
RUN chmod +x /usr/local/lib/node_modules/@virtuals-protocol/acp-cli/bin/acp-cli-signer-linux

WORKDIR /app
COPY seller-v2.mjs .

# /data is a Railway persistent volume — all ACP auth lives here
# so it survives redeploys without needing re-authentication.
ENV DATA_DIR=/data
ENV LOG_DIR=/data/logs
ENV XDG_CONFIG_HOME=/data/config
ENV XDG_DATA_HOME=/data/share
ENV ACP_CONFIG_DIR=/data/config/acp

CMD ["node", "seller-v2.mjs"]
