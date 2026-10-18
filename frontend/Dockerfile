# --- build stage ---
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# VITE_API_BASE is baked in at build time (Vite env vars are static/inlined,
# not read at container-start time) -- override via --build-arg if the
# backend isn't at the default docker-compose service address.
ARG VITE_API_BASE=http://localhost:4000/api/v1
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# --- runtime stage: static files served by nginx ---
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
