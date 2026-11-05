# Node 24 co san `node:sqlite` (DatabaseSync) => KHONG can better-sqlite3.
# Ly do: better-sqlite3 v13 khong con prebuilt binary tren GitHub releases,
# npm install se goi node-gyp compile => phai `apt install python3 build-essential`
# => vi pham rang buoc "khong duoc dung apt trong buoc build".
# Da kiem: 0 asset o release v13.0.3.
FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY scenarios.json ./scenarios.json
# 20 chu de x 4 tang, sinh san bang scripts/gen-content.mjs roi commit.
COPY content ./content
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3040
CMD ["node", "dist/index.js"]
