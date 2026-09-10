FROM node:22-slim
WORKDIR /app
COPY backend/package.json ./
RUN npm install --no-audit --no-fund
COPY backend/ .
EXPOSE 4000
ENV NODE_ENV=production
CMD ["node", "src/server.js"]