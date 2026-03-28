FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install axios @google/generative-ai

COPY agent.js ./

CMD ["node", "agent.js"]
