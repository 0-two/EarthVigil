FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx vite build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY package*.json ./
RUN npm ci --omit=dev && npm i --no-save tsx
COPY --from=build /app/dist ./dist
COPY server ./server
VOLUME /app/data
EXPOSE 8787
CMD ["npx", "tsx", "server/index.ts"]
