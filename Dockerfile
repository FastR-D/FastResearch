FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=
ARG VITE_READ_URL=
ARG VITE_WRITE_URL=
ARG VITE_FASTTASK_URL=
ARG VITE_FASTNEWS_URL=http://47.110.133.67/news/
ARG VITE_FASTPPT_URL=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_READ_URL=$VITE_READ_URL
ENV VITE_WRITE_URL=$VITE_WRITE_URL
ENV VITE_FASTTASK_URL=$VITE_FASTTASK_URL
ENV VITE_FASTNEWS_URL=$VITE_FASTNEWS_URL
ENV VITE_FASTPPT_URL=$VITE_FASTPPT_URL
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0
ENV FASTRESEARCH_DATA_DIR=/app/data
COPY --from=build /app/package*.json ./
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME ["/app/data"]
EXPOSE 8787
CMD ["node", "server/index.mjs"]
