FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY robot-simulator/package.json ./robot-simulator/package.json
RUN npm ci
COPY robot-simulator/tsconfig.json ./robot-simulator/tsconfig.json
COPY robot-simulator/src ./robot-simulator/src
COPY data ./data
WORKDIR /app/robot-simulator
RUN npm run build
CMD ["node", "dist/index.js"]
