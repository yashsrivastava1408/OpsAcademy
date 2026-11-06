# Stage 1: Build React static SPA
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# The API address is compiled into the bundle and into the page's
# Content-Security-Policy, so it must be given at build time.
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=${VITE_API_URL}
# Supabase sign-in (docs/runbooks/auth-cutover.md): a build given these settings signs in through Supabase.
ARG VITE_SUPABASE_URL=
ARG VITE_SUPABASE_ANON_KEY=
ARG VITE_SSO_PROVIDERS=
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY} VITE_SSO_PROVIDERS=${VITE_SSO_PROVIDERS}
RUN npm run build

# Stage 2: Serve static files with Nginx
FROM nginx:alpine

# Upgrade packages to pull in security patches (e.g. brotli-libs CVE fix)
RUN apk upgrade --no-cache

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose HTTP port
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
