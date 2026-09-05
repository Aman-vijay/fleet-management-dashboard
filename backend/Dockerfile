FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY robot-simulator/package.json ./robot-simulator/package.json
RUN npm ci
COPY backend/tsconfig.json ./backend/tsconfig.json
COPY backend/src ./backend/src
COPY data ./data
WORKDIR /app/backend
RUN npm run build
EXPOSE 3000
CMD ["node", "dist/server.js"]
