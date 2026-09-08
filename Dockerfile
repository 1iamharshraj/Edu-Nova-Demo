# EduNova frontend — builds the Vite app, then serves the static bundle with nginx (which also
# reverse-proxies /api to the `api` container; see nginx/default.conf and docker-compose.prod.yml).
#
#   docker build -t edunova-nginx .

# ---- build the SPA ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Same-origin /api in production — nginx proxies it to the `api` service, so the frontend never needs a
# cross-origin URL or CORS. Override at build time (--build-arg VITE_API_BASE=...) only for unusual
# topologies (e.g. API on a separate host).
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# ---- serve ----
FROM nginx:1.27-alpine AS production
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
