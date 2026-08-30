FROM node:20-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
RUN npm install

FROM deps AS build
COPY shared shared
COPY server server
RUN npm run build --workspace shared && npm run build --workspace server

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/shared/package.json shared/package.json
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/package.json server/package.json
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
