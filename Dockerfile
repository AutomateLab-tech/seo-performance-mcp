FROM node:24-slim

# mcp-proxy bridges stdio MCP servers to Glama's sandbox health check.
RUN npm install -g mcp-proxy@6.4.3 @automatelab/seo-performance-mcp@latest

# Placeholder env vars so the server boots without real credentials.
# Real users supply these via their MCP client config.
ENV GSC_SITE_URL=sc-domain:example.com \
    POSTS_SITEMAP_URL=https://example.com/sitemap.xml

ENTRYPOINT ["mcp-proxy", "--", "npx", "-y", "@automatelab/seo-performance-mcp"]
